import asyncio
import json
import os
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


PROJECT_ROOT = Path(r"C:\Users\Administrator\Desktop\ai_project")
AUTH_PATH = Path(r"C:\Users\Administrator\.codex\auth.json")


def build_env() -> dict[str, str]:
    env = os.environ.copy()
    auth = json.loads(AUTH_PATH.read_text(encoding="utf-8"))
    api_key = str(auth.get("OPENAI_API_KEY", "")).strip()
    if not api_key:
        raise RuntimeError(f"OPENAI_API_KEY missing from {AUTH_PATH}")

    env.update(
        {
            "OPENSPACE_HOST_SKILL_DIRS": str(PROJECT_ROOT / ".agents" / "skills"),
            "OPENSPACE_WORKSPACE": str(PROJECT_ROOT),
            "OPENSPACE_MODEL": "openai/gpt-5.4",
            "OPENSPACE_LLM_API_KEY": api_key,
            "OPENSPACE_LLM_API_BASE": "https://cc.maidoucoding.xyz/v1",
            "OPENSPACE_BACKEND_SCOPE": "shell,mcp,web,system",
            "OPENSPACE_MAX_ITERATIONS": "4",
        }
    )
    return env


async def main() -> None:
    server = StdioServerParameters(
        command=str(PROJECT_ROOT / ".venv-openspace" / "Scripts" / "python.exe"),
        args=["-m", "openspace.mcp_server"],
        env=build_env(),
    )

    async with stdio_client(server) as (read_stream, write_stream):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()

            tools = await session.list_tools()
            tool_names = [tool.name for tool in tools.tools]
            print("TOOLS:", json.dumps(tool_names, ensure_ascii=False))

            result = await session.call_tool(
                "search_skills",
                {
                    "query": "storyboard",
                    "source": "local",
                    "limit": 3,
                    "auto_import": False,
                },
            )
            print("SEARCH_RESULT:")
            for item in result.content:
                text = getattr(item, "text", None)
                if text:
                    print(text)


if __name__ == "__main__":
    asyncio.run(main())
