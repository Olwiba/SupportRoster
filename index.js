var express = require('express');
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

slackEvents.on('app_mention', async (event) => {
    try {
        console.log("I got a mention in this channel", event.channel);
        const res = await webClient.chat.postMessage({
            text: 'Hello there',
            channel: conversationId,
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