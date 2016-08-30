"use strict";

let newrelic = process.env.NODE_ENV === 'production' ? require('newrelic') : undefined;

let koa = require('koa'),
	mount = require('koa-mount'),
	route = require('koa-route');

const SUPPORTED_METHODS = ['GET', 'POST', 'PUT', 'DELETE'];

module.exports = function () {
	let app = koa();
	app.path = '';

	let paths = {};

	SUPPORTED_METHODS.forEach(function (method) {

		let lwrMethod = method.toLowerCase();
		app[lwrMethod] = function (path, queryParams, bodyParams, gn) {

			function* wrapped() {
				if (newrelic) {
					newrelic.setTransactionName((app.routerPath() + path).replace(/^\//, ''));
				}

				if (queryParams) {
					this.verifyParams(queryParams, this.query);
				}
				if (bodyParams) {
					this.verifyParams(bodyParams, this.request.body || {});
				}

				this.params = {};

				for (let queryKey of Object.keys(this.query)) {
					this.params[queryKey] = this.query[queryKey];
				}

				if (this.request.body) {
					for (let bodyKey of Object.keys(this.request.body)) {
						this.params[bodyKey] = this.request.body[bodyKey];
					}
				}

				yield gn.apply(this, arguments);
			}

			app.use(route[lwrMethod](path, wrapped));

			paths[path] = paths[path] || [];
			paths[path].push(method);
		};
	});

	app.mount = function (path, subapp) {
		subapp.wrongMethodCheck();
		subapp.parent = app;
		subapp.path = path;
		app.use(mount(path, subapp));
	};

	app.wrongMethodCheck = function () {
		Object.keys(paths).forEach(function (path) {
			app.use(route.all(path, function* () {
				this.set('Allow', paths[path].join(', '));
				this.throw(405);
			}));
		});
	};

	app.routerPath = function () {
		return (app.parent ? app.parent.routerPath() : '') + app.path;
	};

	return app;
};
