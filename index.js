const config = require("config");
const express = require("express");
const basicAuth = require("express-basic-auth");
const serveStatic = require("serve-static");
const nunjucks = require("nunjucks");
const { httplogger, logger } = require("./lib/log");
// eslint-disable-next-line no-unused-vars
const { listShows, aboutShow, aboutShowRSS, serveDebugData } = require("./lib/routes");
const path = config.get("path");
const imagePath = config.get("imagePath");
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
// app.get("/json", serveDebugData);
app.use("/audio", serveStatic(path));
app.use("/static", serveStatic("static"));
app.use("/images", serveStatic(imagePath));
app.get("/:show", aboutShow);
app.get("/:show/rss", aboutShowRSS);

app.listen(config.get("listen"), () => logger.log({level: "info", message: "Majorpodo server now listening" }) );
