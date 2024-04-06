import { Intents, Client } from 'discord.js';
import axios from 'axios';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { promisify } from 'util';

require('dotenv').config();

// Promisify the 'fs' module functions
const writeFileAsync = promisify(fs.writeFile);
const unlinkAsync = promisify(fs.unlink);

const channelUrlMap: Record<string, string> = JSON.parse(process.env.CHANNEL_URL_MAP || '{}');

const client = new Client({
    intents: [
        Intents.FLAGS.GUILDS, // include guild-related intents
        Intents.FLAGS.GUILD_MESSAGES, // include message-related intents
        Intents.FLAGS.DIRECT_MESSAGES, // include direct message-related intents
        Intents.FLAGS.GUILD_MESSAGE_REACTIONS, // include message reaction-related intents
    ]
});

client.on('ready', () => {
    console.log(`Logged in as ${client.user?.tag}!`);
    client.guilds.cache.forEach(guild => {
        guild.channels.cache.forEach(channel => {
            if (channel.type === 'GUILD_TEXT' && channel.permissionsFor(client.user?.username || '')?.has('SEND_MESSAGES')) {
                channel.send('I am now online!');
            }
        });
    });
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) {
        console.log(`Discarding message from bot`);
        return; // Ignore messages from bots
    }
    const botMention = `<@${client.user?.id}>`; // Mention of the bot
    const messageText = message.content;
    if (!messageText.startsWith(botMention)) {
        console.log(`Discarding message "${messageText}" not addressed to bot`);
        return; // Ignore messages not addressed to the bot
    }
    const prompt = messageText.substring(messageText.indexOf(botMention) + 1);
    const channelId = message.channel.id;
    const channelUrl = channelUrlMap[channelId];
    if (!channelUrl) {
        await message.reply('This channel is not supported by the bot.');
        return;
    }

    try {
        const authHeader = `Basic ${process.env.BEAM_AUTH_TOKEN}`;
        // Step 2a: Do a POST request to the REST API
        const taskId = await axios.post(`https://${channelUrl}.apps.beam.cloud`, {
            prompt: prompt
        }, {
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            }
        }).then(response => {
            if (response.status !== 200) {
                throw new Error(`Invalid response ${response.status}`);
            }
            return response.data.task_id;
        });

        // Step 2b: Notify on the message thread
        await message.reply(`[Request in process](https://www.beam.cloud/apps/${channelUrl}/tasks/${taskId})`);

        // Step 2c: Poll every 3 seconds
        let status = 'PENDING';
        let pollResponse;
        while (status === 'PENDING' || status === 'RUNNING') {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            pollResponse = await axios.get(`https://api.beam.cloud/v1/task/${taskId}/status/`,
                {
                    headers: {
                        'Authorization': `Basic ${process.env.BEAM_AUTH_TOKEN}`
                    }
                }
            ).then(response => response.data);
            status = pollResponse.status;
        }

        // Step 2d: Get the image URL
        if (status === 'COMPLETE') {
            const imageUrl = pollResponse?.outputs['./output.png'].url;

            // Step 2e: Download the image
            // Generate a unique file name
            const fileName = `image_${uuidv4()}.png`;

            // Download the image
            const imageResponse = await axios.get(imageUrl, {
              responseType: 'arraybuffer'
            });

            // Save the image to a file
            await writeFileAsync(fileName, imageResponse.data);

            // Post the image in the message thread
            await message.reply({ 
                content: "Here's your generated image",
                files: [
                    {
                        attachment: fileName,
                        name: fileName
                    }
                ] 
            });
          
            // Delete the image file after posting
            await unlinkAsync(fileName);
        } else {
            // Notify that the request failed
            await message.reply('Request failed');
        }
    } catch (error) {
        console.error('Error:', error);
        await message.reply(`An error occurred: ${error}`);
    }
});

client.login(`${process.env.DISCORD_BOT_TOKEN}`);
