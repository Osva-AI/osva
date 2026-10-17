# osva-sdk

Official OSVA SDK for Python (>=3.11).

Install from PyPI:

```bash
pip install osva-sdk==1.1.0rc2
```

Authenticated smoke test (no `auth` resource on `OSVAClient`):

```python
import os

from osva import OSVAClient

client = OSVAClient(
    base_url=os.environ["OSVA_BASE_URL"],
    api_key=os.environ["OSVA_API_KEY"],
)
print(client.agents.list())
```
