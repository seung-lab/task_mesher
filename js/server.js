const cors = require('koa-cors');
const bodyParser = require('koa-body-parser');

const app = require('./mykoa.js')();
const parameter = require('koa-parameter');
const log = require('./logging.js').log;

parameter(app);
app.use(bodyParser());
app.use(logger);
app.use(errorHandler);
app.use(cors());

app.mount('/', require('./rtm.js'));

const port = Number(process.env.PORT);

if (port) {
    app.listen(port);
} else {
    console.log('missing port number');
}


// basic logging of network requests (url, method, time)
function* logger (next) {
	logger.reqCounter = (logger.reqCounter || 0) + 1;

	if (newrelic) {
		newrelic.setTransactionName('*');
	}

	const requestInfo = {url: this.url, method: this.method};

	if (this.request.body) {
		requestInfo.body = this.request.body;
	}

	this.log = log.child({reqId: logger.reqCounter, request: requestInfo}, true); // simple/fast option

	this.log.info({ event: 'startRequest' });

	const start = process.hrtime();
	yield next;
	const elapsed = process.hrtime(start);
	const ms = (elapsed[0] * 1e9 + elapsed[1]) / 1e6;

	this.log.info({status: this.status, ms: ms, event: 'completeRequest'});
}

// forms error messages and logs them
function* errorHandler(next) {
	try {
		yield next;

	//	if (this.method === 'GET' && (this.status === 204 || (this.status !== 404 && utils.isEmpty(this.body)))) {
	//		this.throw(204); // TODO, is this working?, also maybe sometimes we would want to return an empty body, this is really for development
	//	}

		if (this.status !== 404 && isUndefinedInObject(this.body)) {
			this.log.warn({body: this.body, event: 'objectWithUndefined'});
		}

	} catch (e) {
		this.status = e.status || 500;
		this.body = {
			error: this.status === 500 ? 'Internal Server Error' : e.message
		};

		if (this.status === 500) {
			// note, mocha will prevent a slack error from being sent
			// because it shuts down node right after the error is encountered
			// not a problem because we don't need to use slack for debugging tests
			this.log.error({event: 'errorHandler', err: e});
		} else {
			const logMsg = {event: 'errorHandler', err: e};

			if (this.status === 422) {
				const validationMsg = {
					errors: e.errors,
					params: e.params,
				};

				this.body.reason = validationMsg;
				logMsg.reason = validationMsg;
			}

			this.log.warn(logMsg);
		}
	}
}
