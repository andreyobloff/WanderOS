def generate_batch_stub(topic: str, count: int) -> list[str]:
    return [f"Квест №{i + 1}: {topic}" for i in range(count)]
