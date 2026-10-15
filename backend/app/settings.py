from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="TVOPT_", extra="ignore")

    host: str = "127.0.0.1"
    port: int = 8765
    data_dir: Path = Field(default=Path("data"))
    extension_token: str | None = Field(default=None, min_length=16)

    @property
    def database_url(self) -> str:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{(self.data_dir / 'optimiser.db').resolve()}"

    @property
    def extension_token_path(self) -> Path:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        return self.data_dir / "extension-token"
