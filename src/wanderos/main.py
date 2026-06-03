from wanderos.bot import run_bot
from wanderos.logger import setup_logging


def main() -> None:
    setup_logging()
    run_bot()


if __name__ == "__main__":
    main()
