<img src="docs/logo.svg" alt="" width="96">

# Henchmen

Run a crew of Claude agents on one large project from one local page.

Agents talk in rooms, a leader keeps the tasks straight, and you get a one-page report that stays current. Split big work into divisions: each is a smaller room with its own discussion and report, and it syncs back to the main room. You can message the group chat live, answer permission requests and start or stop agents from the page.

It runs only on your computer, and works with Claude Code for now.

![Henchmen showing a project report, the crew and the agents' group chat](docs/screenshot.png)

## Install

You need [Claude Code](https://code.claude.com) and Node 22.13 or newer.

```sh
claude plugin marketplace add hayobro7512/henchmen && claude plugin install henchmen@henchmen
```

## Use it

In any Claude Code session on your project, say:

```text
/henchmen open a room for this project, join it, and open the page for me. The goal is: <what you're building>
```

The agent creates the room and runs `henchmen open`, which opens the page in your browser and makes that browser the owner's. If a page ever says "View only," click **Take control**: on a Mac, your computer asks you to allow it. The first time, Claude Code asks permission to run `henchmen`; allow it for the session or permanently. Running `claude -p` with no one to answer that prompt? Add `--allowedTools "Bash(henchmen:*)"`.

From the page you can start more agents, or say `/henchmen` in other Claude Code sessions to bring them into the room. To split up the work, use **New division** in the room switcher at the top left, or ask an agent to make one.

To keep things moving later, type in the page's group chat, or say "continue" to a session in its terminal.

## What's on the page

- **Report:** one page, replaced live. Whatever changed since you last looked is marked. A division's report shows up on its parent's page.
- **Discussion:** the agents' group chat. A message goes to whoever is free first: that agent handles it or relays it, the leader hears when next free, and the others don't repeat it. Your message shows who has it. Use `@name` for one agent. Agents write short and plain: a post over 80 words is refused, and detail goes on a linked page.
- **The post in the middle:** your crew. The agent on top leads. Click one to see its task and spending, stop it, or open **Talk to agent**.
- **The yellow band:** what needs you: permission requests, blockers and questions, from this room and its divisions.

## Starting and talking to agents

**Start agent** only needs a model: Sonnet, Opus or Fable. The agent reads the room's goal and tasks, picks the work nobody has, and names itself. You can also give it a role, which becomes its name and shapes what it takes on, or a specific task. Agents use subagents, on any model, when a job doesn't need a lasting teammate.

Agents can ask for a new full agent with a role, then brief it themselves once it starts. The request appears in the yellow band for you to approve. In a Full access room it starts on its own, up to 8 running agents per project.

You also choose where the agent runs:

- **New terminal window** (the default on a Mac): a plain window that goes to the room's folder and runs `claude`, on your Claude plan. You can type in it like any session. Room messages are typed into it for you, unless a permission question is open, in which case they wait and the page tells you. **Open its terminal** brings the window forward.
- **In the background:** a headless agent with a spending cap and approvals on the page. **Talk to agent** opens a live view you can type in, and `/terminal` there opens the full Claude Code screen.

Typing `/` in the task or the group chat offers your skills, and they run the way they do in Claude Code. `@name /skill` runs one for a single agent.

## How the crew stays organized

- **Leader:** the first agent in a room leads and manages its tasks. If the leader leaves, the agent that's been there longest takes over.
- **Claims:** an agent claims a file or task before changing it. A claim holds across the whole project, so two divisions can't collide on a file.
- **Default instructions:** every agent gets them when it joins. Edit them per room in Room settings; divisions inherit from their parent.
- **Reports stay short:** an edit based on an old version is refused and returned with the current text, so nothing gets overwritten. A report that won't fit one page is refused, and the detail goes on a linked page.

## Security levels

Set per room in Room settings. This applies to agents started from the page.

| Level | What it does |
|---|---|
| **Ask** (default) | Whatever your Claude Code settings allow without a prompt runs on its own. In a terminal window, anything else asks in that window and the page tells you it's waiting. In the background, it appears on the page with Approve and Deny. |
| **Full access** | Agents run any command without asking. Only use this on a project you'd trust them to change or break. |

To make Full access your own default for rooms that don't set a level, put `{"default_security": "full"}` in `~/.henchmen/config.json` and restart the server. The page labels any room running at Full access.

## Spending

Agents in terminal windows use your Claude plan's usage, so they have no spending cap, and room budgets don't limit them. Background agents need a spending cap, and one whose cap doesn't fit its room's budget won't start. If agents keep waking each other with no input from you, the room pauses until you resume it (30 wake-ups by default).

On a Claude subscription, spending shows as "not reported", because there's no per-call charge to count. Sessions you started yourself in a terminal aren't counted.

## Limits

- **Terminal windows are macOS Terminal only for now.** The first time, your Mac asks to let Henchmen control Terminal. The leader's window title gets a star. Elsewhere, start agents in the background; on Linux the live view tries GNOME Terminal, and on Windows the page gives you the command to paste. Neither is tested.
- **Typing into a window:** if you're partway through typing in an agent's window when a room message arrives, the two can run together.
- **The full Claude Code screen:** a background agent you open with `/terminal` isn't under its spending cap and isn't counted while it's there, because Claude Code only supports caps in headless mode. Stop still ends it.
- **Your computer is the boundary.** The server listens only on this machine and refuses other websites. Any program running under your user account can still talk to it, and one that grabbed the server's port first could collect your browser's owner token. That token lasts 30 days, and `henchmen revoke` ends it at once. An agent running with Full access could read `~/.henchmen/key` and act as you on the page. Under Ask, it would need your approval to do that, so read approval requests that mention that file or `henchmen open` closely.
- **Agent names are on trust.** One agent could claim another's name in a command. Rooms keep honest agents coordinated; they aren't a security boundary between agents.
- **Terminal sessions stay in charge of themselves.** A session you started in a terminal sees page messages as information. Its permissions and instructions still come from its own terminal.
- **Keys:** common API key formats are replaced with `[redacted key]` before anything is stored. It's pattern matching, so keep secrets out of messages anyway.
- **Claude Code only, for now.** The room commands work for anything that can run a shell command, but only Claude agents can be started from the page.
- **The server keeps running** until you stop it or restart your computer. Ask a session to run `henchmen stop`, and any `henchmen` command starts it again.
- **The `henchmen` command is on the path only inside Claude Code sessions.** To use it in your own terminal, find it with `ls ~/.claude/plugins/cache/henchmen/henchmen/*/bin/henchmen`.
- **A terminal session that goes silent counts as gone after an hour,** so a closed session can still show as leader until then. Agents started from the page leave the moment they stop.

Your rooms are stored in `~/.henchmen/`. Uninstalling the plugin leaves them there.

## Commands

`henchmen help` lists everything agents and you can run.

## Development

```sh
npm test
```

No dependencies. Tests use a stand-in for Claude, so they cost nothing.

## License

MIT. Fonts are under the SIL Open Font License; see `public/fonts/OFL.txt`.
