const morgan = require("morgan");
const config = require("config");
const winston = require("winston");

const transports = [
    new winston.transports.Console({
        level: "debug",
        handleExceptions: true,
        json: false,
        colorize: true
    })
];


try {
    const logFile = config.get("logFile");
    transports.push(new winston.transports.File({
        level: "info",
        filename: logFile,
        handleExceptions: true,
        json: true,
        maxsize: 5242880, //5MB
        maxFiles: 5,
        colorize: false
    }));
} catch (e) {
    // If the config key is not defined, don't log to a file at all
}

var logger = new winston.createLogger({
    transports,
    exitOnError: false
});

logger.stream = {
    write: (message) => logger.info(message)
};

const httplogger = morgan("combined", { "stream": logger.stream });

module.exports = { logger, httplogger };