'use strict';

const express = require('express');
const https = require('https');
const dotenv = require('dotenv');
const fs = require('fs');
const bodyParser = require('body-parser');
const { createEventAdapter } = require('@slack/events-api');
const { WebClient } = require('@slack/web-api');

dotenv.config();

// Config ================================================================================|
const app = express();
const port = process.env.PORT || 3000;

const slackToken = process.env.SLACK_OAUTH_TOKEN;
const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;

// Event middlewear ======================================================================|
const webClient = new WebClient(slackToken);
const slackEvents = createEventAdapter(slackSigningSecret);

app.use('/slack/events', slackEvents.expressMiddleware());

// Body-parser middlewear ===============================================================|
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

// Data fetching ========================================================================|
async function getJsonObjectFromURL(url) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        try {
            https.get(url, res => {
                console.log('statusCode:', res.statusCode);
                res.setEncoding('utf8')
                .on('data', (chunk) => {
                    chunks.push(chunk);
                })
                .on('end', () => {
                    resolve(JSON.parse(chunks.join('')));
                });
            }).on('error', e => reject(e));
        } catch (err) {
            reject(err);
        }
    });
};

const getUserName = async (userId) => {
    const endpoint = `https://slack.com/api/users.info?token=${slackToken}&user=${userId}&pretty=1`;

    return await getJsonObjectFromURL(endpoint)
    .then(data => {
        return data.user.profile.real_name;
    })
    .catch(err => console.error(err));
};

// Actions ===========================================================================|
const availableActions = Object.freeze({
    help: 'help',
    list: 'list',
    add: 'add',
    remove: 'remove',
    skip: 'skip',
    back: 'back',
});

const deriveAction = (input) => {
    const inputParts = input.split(' ');

    // Check for target actions
    if (inputParts.includes('help')) { return availableActions.help; }
    else if (inputParts.includes('list')) { return availableActions.list; }
    else if (inputParts.includes('add')) { return availableActions.add; }
    else if (inputParts.includes('remove')) { return availableActions.remove; }
    else if (inputParts.includes('skip')) { return availableActions.skip; }
    else if (inputParts.includes('back')) { return availableActions.back; }
    else { return undefined; }
};

// Messages =========================================================================|
const sendMessage = async (messageText, channel) => {
    const res = await webClient.chat.postMessage({
        text: messageText,
        channel: channel,
    });
    console.log('Message sent: ', res.ts);
};

const unknownMessage = (channel) => {
    sendMessage(
`Sorry, I didn't understand that command. \n
Type \`@SupportRoster help\` to learn more.`,
        channel
    );
};

const helpMessage = (channel) => {
    sendMessage(
`Here's a list of my available commands: \n
\`@SupportRoster list [all|cr|rum|apm|ss]\` - Lists the roster for a team \n
\`@SupportRoster add [@user] [cr|rum|apm|ss]\` - Adds a user to a team roster \n
\`@SupportRoster remove [@user] [cr|rum|apm|ss]\` - Removes a user from a team roster \n
\`@SupportRoster skip [cr|rum|apm|ss]\` - Moves forward one in the queue for a team \n
\`@SupportRoster back [cr|rum|apm|ss]\` - Moves back one in the queue for a team`,
        channel
    );
};

// File system =====================================================================|
const readFile = (targetFile) => {
    const rawData = fs.readFileSync(targetFile);
    return JSON.parse(rawData);
};

const writeFile = (data, outputFile) => {
    const stringifiedData = JSON.stringify(data);
    fs.writeFileSync(outputFile, stringifiedData);
};

// Events =========================================================================|
slackEvents.on('app_mention', async (event) => {
    try {
        console.log("I got a mention in this channel: ", event.channel);
        const mentionText = event.text;
        const intendedAction = deriveAction(mentionText);
        const userName = await getUserName(event.user);

        if (intendedAction != undefined) {
            if (intendedAction === availableActions.help) { helpMessage(event.channel); }
            else if (intendedAction === availableActions.list) { sendMessage(`List...`, event.channel); }
            else if (intendedAction === availableActions.add) { sendMessage(`Add...`, event.channel); }
            else if (intendedAction === availableActions.remove) { sendMessage(`Remove...`, event.channel); }
            else if (intendedAction === availableActions.skip) { sendMessage(`Skip...`, event.channel); }
            else if (intendedAction === availableActions.back) { sendMessage(`Back...`, event.channel); }
            else { unknownMessage(event.channel); }
        } else { unknownMessage(event.channel); }
    } catch (e) {
        console.log(JSON.stringify(e))
    }
});

// Start server ===================================================================|
app.listen(port, function () {
    // Callback triggered when server is successfully listening.
    console.log("SupportRoster bot listening on port: " + port);
});