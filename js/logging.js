'use strict';

const bunyan = require('bunyan');

let slackCount = 0;
const SLACK_THRESHOLD_RATE = 10;
const SLACK_THRESHOLD = 3;
const SLACK_COUNT_CAP = 5;

// limit the number of slack requests once the threshold is passed
setInterval(function () {
	slackCount = Math.max(0, slackCount - 1);
}, SLACK_THRESHOLD_RATE * 1000);

class NullStream { write () {} }

const slackStream = new NullStream();

if (process.env.NODE_ENV && process.env.NODE_ENV !== 'test') {
	const BunyanSlack = require('bunyan-slack');

	slackStream = new BunyanSlack({
		webhook_url: 'https://hooks.slack.com/services/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',
		customFormatter: function (record, levelName) {
			if (record.err) {
				const err = record.err;

				slackCount = Math.min(SLACK_COUNT_CAP, slackCount + 1);
				if (slackCount === SLACK_THRESHOLD + 1) {
					return {
						text: `Errors are being rate limited.
No further errors will be posted until the error rate falls below ${SLACK_THRESHOLD_RATE} seconds.
Inspect the error logs to view all errors.`
					};
				} else if (slackCount > SLACK_THRESHOLD) {
						throw Error('too many slacks'); // TODO, this is a super hack but I don't want to modify BunyanSlack
				}

				return {
					attachments: [{
						color: 'danger',
						title: `${err.status} - ${err.name}`,
						text: `
Request ID: ${record.reqId}
Stack:
\`\`\`${err.stack}\`\`\`
						`,
						mrkdwn_in: ["text", "pretext"]
					}]
				};
			} else {
				return {
					text: "[" + levelName + "] " + JSON.stringify(record)
				};
			}
		}
	});
}

function getFullErrorStack(ex) {
	return ex.stack || ex.toString();
}

let serializers = {
	err: function (err) {
		return {
			message: err.message,
			name: err.name,
			stack: getFullErrorStack(err),
			code: err.code,
			signal: err.signal,
			status: err.status
		};
	}
};

exports.log = bunyan.createLogger({
	name: 'rtm',
	serializers: serializers,
	streams: [
		{
			level: 'debug',
			path: 'logs/everything.log'
		},
		{
			level: 'warn',
			path: 'logs/error.log'
		},
		{
			level: 'warn',
			stream: process.stdout
		},
		{
			level: 'error',
			stream: slackStream,
			type: 'raw'
		}
	]
});
