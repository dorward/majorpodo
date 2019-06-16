const basicAuth = require("express-basic-auth");
const config = require("config");

let auth, users;

try {
    users = config.get("users").reduce( (accumulator, currentValue) => {
        accumulator[currentValue.username] = currentValue.password;
        return accumulator;
    }, {} );
    auth = basicAuth({
        users,
        challenge: true,
        realm: "majorpodo",
    });
} catch (e) {
    // No auth configuration
}

module.exports = auth;