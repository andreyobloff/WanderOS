from apscheduler.schedulers.background import BackgroundScheduler


scheduler = BackgroundScheduler()


def start_scheduler() -> None:
    if not scheduler.running:
        scheduler.start()


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown()
