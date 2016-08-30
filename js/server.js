let cors = require('koa-cors');
let bodyParser = require('koa-body-parser');

let app = require('./mykoa.js')();
let parameter = require('koa-parameter');

parameter(app);
app.use(bodyParser());

app.use(cors());

app.mount(require('./rtm.js'));

let port = Number(process.env.PORT);

if (port) {
    app.listen(port);
} else {
    console.log('missing port number');
}
