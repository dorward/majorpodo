const config = require("config");
const express = require("express");
const basicAuth = require("express-basic-auth");
const serveStatic = require("serve-static");
const nunjucks = require("nunjucks");
const { httplogger } = require("./lib/log");
const { listShows, aboutShow, aboutShowRSS, serveDebugData } = require("./lib/routes");
const path = config.get("path");
const users = config.get("users").reduce( (accumulator, currentValue) => {
    accumulator[currentValue.username] = currentValue.password;
    return accumulator;
}, {} );

nunjucks.configure("views", { autoescape: true });

const app = express();
app.use(httplogger);
if (users.length) {
    app.use(basicAuth({
        users,
        challenge: true,
        realm: "majorpodo",
    }));
}
app.get("/", listShows);
app.get("/:show", aboutShow);
app.get("/:show/rss", aboutShowRSS);
app.get("/json", serveDebugData);
app.use("/audio", serveStatic(path));
app.use("/static", serveStatic("static"));

app.listen(config.get("listen"), () => process.stdout.write("Majorpodo server now listening\n") );
