import pytest

pytest_plugins = []


def pytest_collection_modifyitems(config, items):
    for item in items:
        item.add_marker(pytest.mark.asyncio)
