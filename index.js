const express = require('express');
const https = require('https');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');
const { createEventAdapter } = require('@slack/events-api');
const { WebClient } = require('@slack/web-api');

dotenv.config();

// Instantiate Express
var app = express();
const port = process.env.PORT || 3000;

// Config
var slackToken = process.env.SLACK_OAUTH_TOKEN;
var slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
const conversationId = 'G0115E1G5DZ';

// Event middlewear
const webClient = new WebClient(slackToken);
const slackEvents = createEventAdapter(slackSigningSecret);

app.use('/slack/events', slackEvents.expressMiddleware());

// Body-parser middlewear
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

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

slackEvents.on('app_mention', async (event) => {
    try {
        console.log("I got a mention in this channel", event.channel);
        const userName = await getUserName(event.user);
        console.log('username is: ', userName);

        const res = await webClient.chat.postMessage({
            text: `Hello there, ${userName}`,
            channel: event.channel,
        });
        console.log('Message sent: ', res.ts);
    } catch (e) {
        console.log(JSON.stringify(e))
    }
});

// Start server
app.listen(port, function () {
    // Callback triggered when server is successfully listening.
    console.log("SupportRoster bot listening on port: " + port);
});