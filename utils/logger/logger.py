import logging
import os
import sys
import inspect
from logging.handlers import RotatingFileHandler
from threading import Lock


class SingletonMeta(type):
    _instances = {}
    _lock = Lock()

    def __call__(cls, *args, **kwargs):
        with cls._lock:
            if cls not in cls._instances:
                instance = super().__call__(*args, **kwargs)
                cls._instances[cls] = instance
        return cls._instances[cls]


class AppLogger(metaclass=SingletonMeta):
    def __init__(self, log_dir='/logs', max_bytes=100*1024*1024, backup_count=5, level=logging.DEBUG):
        service_name = os.getenv('SERVICE_NAME', 'default')
        log_path = os.path.join(log_dir, service_name)
        os.makedirs(log_path, exist_ok=True)

        log_file = os.path.join(log_path, f'{service_name}.log')

        self.logger = logging.getLogger(service_name)
        self.logger.setLevel(level)

        if not self.logger.handlers:
            formatter = logging.Formatter(
                '[%(asctime)s] [%(levelname)s] [%(filename)s:%(lineno)d] - %(message)s',
                datefmt='%Y-%m-%d %H:%M:%S'
            )

            file_handler = RotatingFileHandler(log_file, maxBytes=max_bytes, backupCount=backup_count)
            file_handler.setFormatter(formatter)
            self.logger.addHandler(file_handler)

            stream_handler = logging.StreamHandler(sys.stdout)
            stream_handler.setFormatter(formatter)
            self.logger.addHandler(stream_handler)

    def _add_caller_info(self, msg):
        frame = inspect.stack()[2]
        filename = os.path.basename(frame.filename)
        lineno = frame.lineno
        return f"[{filename}:{lineno}] - {msg}"

    def info(self, msg, caller_info=True):
        self.logger.info(self._add_caller_info(msg) if caller_info else msg)

    def warn(self, msg, caller_info=True):
        self.logger.warning(self._add_caller_info(msg) if caller_info else msg)

    def warning(self, msg, caller_info=True):
        self.logger.warning(self._add_caller_info(msg) if caller_info else msg)

    def error(self, msg, caller_info=True):
        self.logger.error(self._add_caller_info(msg) if caller_info else msg)

    def debug(self, msg, caller_info=True):
        self.logger.debug(self._add_caller_info(msg) if caller_info else msg)

    def get_logger(self):
        return self.logger
