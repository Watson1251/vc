const path = require('path');
const fs = require('fs');
const winston = require('winston');

function getCallerFileAndLine() {
    const originalFunc = Error.prepareStackTrace;
    Error.prepareStackTrace = (_, stack) => stack;
    const err = new Error();
    const stack = err.stack;
    Error.prepareStackTrace = originalFunc;

    // Depth explanation:
    // 0: getCallerFileAndLine
    // 1: _logWithLocation
    // 2: info()
    // 3: yourApp.js ←✅ This is what you want
    const caller = stack[3] || stack[2]; // fallback for safety
    const file = path.basename(caller.getFileName());
    const line = caller.getLineNumber();
    return `${file}:${line}`;
}


class AppLogger {
    constructor() {
        if (AppLogger.instance) return AppLogger.instance;

        const serviceName = process.env.SERVICE_NAME || 'default';
        const logDir = path.join('/logs', serviceName);
        fs.mkdirSync(logDir, { recursive: true });

        const logFile = path.join(logDir, `${serviceName}.log`);

        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                winston.format.printf(({ level, message, timestamp }) => {
                    return `[${timestamp}] [${level.toUpperCase()}] - ${message}`;
                })
            ),
            transports: [
                new winston.transports.File({
                    filename: logFile,
                    maxsize: 100 * 1024 * 1024,
                    maxFiles: 5,
                }),
                new winston.transports.Console()
            ]
        });

        AppLogger.instance = this;
    }

    _logWithLocation(level, msg) {
        const location = getCallerFileAndLine();
        this.logger.log(level, `[${location}] - ${msg}`);
    }

    info(msg) {
        this._logWithLocation('info', msg);
    }

    warn(msg) {
        this._logWithLocation('warn', msg);
    }

    error(msg) {
        this._logWithLocation('error', msg);
    }

    debug(msg) {
        this._logWithLocation('debug', msg);
    }
}

module.exports = new AppLogger();
