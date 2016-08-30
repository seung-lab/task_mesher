let cors = require('koa-cors');
let bodyParser = require('koa-body-parser');

let app = require('./mykoa.js')();
let parameter = require('koa-parameter');

parameter(app);
app.use(bodyParser());
app.use(errorHandler);
app.use(cors());

app.mount('/', require('./rtm.js'));

let port = Number(process.env.PORT);

if (port) {
    app.listen(port);
} else {
    console.log('missing port number');
}




// forms error messages and logs them
function* errorHandler(next) {
	try {
		yield next;

	//	if (this.method === 'GET' && (this.status === 204 || (this.status !== 404 && utils.isEmpty(this.body)))) {
	//		this.throw(204); // TODO, is this working?, also maybe sometimes we would want to return an empty body, this is really for development
	//	}

	//	if (this.status !== 404 && isUndefinedInObject(this.body)) {
	//		this.log.warn({body: this.body, event: 'objectWithUndefined'});
	//	}

	} catch (e) {
		this.log = console;
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
			let logMsg = {event: 'errorHandler', err: e};

			if (this.status === 422) {
				let validationMsg = {
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
