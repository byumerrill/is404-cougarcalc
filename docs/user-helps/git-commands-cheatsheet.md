# Git Commands Cheat Sheet for CougarCalc / IS 404

This sheet collects the Git commands we used while preparing CougarCalc Release 1 and the course release workflow.

## Common commands

### `git status`
**Syntax**
```bash
git status
```

**What it does**  
Shows the current state of the working tree and staging area.

**Why we run it**  
It is the first check before making changes, committing, pulling, or tagging. It tells you whether you have uncommitted work and whether the branch is clean.

**Key output to look for**
- `On branch ...`
- `nothing to commit, working tree clean`
- modified or untracked files

---

### `git branch --show-current`
**Syntax**
```bash
git branch --show-current
```

**What it does**  
Prints the name of the branch you are currently on.

**Why we run it**  
Before pulling, pushing, or tagging, you want to know whether you are on `main`, `course`, or something else.

**Parameters**
- `--show-current` = print only the active branch name

---

### `git branch -vv`
**Syntax**
```bash
git branch -vv
```

**What it does**  
Shows local branches, their latest commit, and whether they track a remote branch.

**Why we run it**  
This is the easiest way to confirm whether `course` is tracking `origin/course` or whether `main` is tracking `origin/main`.

**Parameters**
- `-v` = verbose branch listing
- `-vv` = extra verbose; includes upstream tracking info

---

### `git branch -a`
**Syntax**
```bash
git branch -a
```

**What it does**  
Lists all local branches and remote-tracking branches.

**Why we run it**  
Useful after `git fetch` when you want to see whether GitHub has a branch such as `origin/course`.

**Parameters**
- `-a` = show all branches, including remote-tracking branches

---

### `git log -1 --oneline`
**Syntax**
```bash
git log -1 --oneline
```

**What it does**  
Shows the most recent commit in short form.

**Why we run it**  
Before tagging or deploying, this confirms exactly which commit you are looking at.

**Parameters**
- `-1` = show only one commit
- `--oneline` = compact single-line commit format

---

### `git log --oneline --graph --decorate -n 20`
**Syntax**
```bash
git log --oneline --graph --decorate -n 20
```

**What it does**  
Shows a compact view of recent Git history, including branch pointers and tags.

**Why we run it**  
Helpful when you are trying to understand the shape of history, see where a release branch diverged, or identify a clean release checkpoint.

**Parameters**
- `--oneline` = compact format
- `--graph` = ASCII graph of branch structure
- `--decorate` = show branch and tag names
- `-n 20` = show the most recent 20 commits

---

### `git remote -v`
**Syntax**
```bash
git remote -v
```

**What it does**  
Shows the remote repository URLs used for fetch and push.

**Why we run it**  
This confirms that your deployment clone points to the correct GitHub repo and, in our case, the correct SSH alias.

**Parameters**
- `-v` = verbose; shows both fetch and push URLs

---

### `git fetch origin`
**Syntax**
```bash
git fetch origin
```

**What it does**  
Downloads new commits, branches, and tags from the remote named `origin` without changing your working files.

**Why we run it**  
Use this when you want Git to learn about new remote branches or new commits before switching branches or pulling.

**Parameters**
- `origin` = the remote name to fetch from

---

### `git switch course`
**Syntax**
```bash
git switch course
```

**What it does**  
Moves your working copy to the local `course` branch.

**Why we run it**  
Use this when the branch already exists locally and you want to work on or deploy from it.

**Parameters**
- `course` = the branch to switch to

---

### `git switch -c course`
**Syntax**
```bash
git switch -c course
```

**What it does**  
Creates a new local branch named `course` and switches to it.

**Why we run it**  
Useful when you want to create the release-prep branch from your current commit.

**Parameters**
- `-c` = create a new branch

---

### `git switch --track origin/course`
**Syntax**
```bash
git switch --track origin/course
```

**What it does**  
Creates a local branch that tracks `origin/course` and switches to it.

**Why we run it**  
This is the clean way to bring a remote branch down to a local branch and set up tracking in one step.

**Parameters**
- `--track` = create a local branch that tracks the remote branch
- `origin/course` = the remote branch to track

---

### `git pull --ff-only`
**Syntax**
```bash
git pull --ff-only
```

**What it does**  
Fetches and then updates your current branch only if the update can be done as a fast-forward.

**Why we run it**  
On the Ubuntu deployment clone, this keeps the repo clean and prevents Git from creating a merge commit.

**Parameters**
- `--ff-only` = allow only fast-forward updates

---

### `git pull --ff-only origin course`
**Syntax**
```bash
git pull --ff-only origin course
```

**What it does**  
Pulls from the `course` branch on the `origin` remote and updates the current branch only if the move is a fast-forward.

**Why we run it**  
We used this when the Ubuntu clone was first getting onto the release-prep branch.

**Parameters**
- `origin` = remote name
- `course` = remote branch name
- `--ff-only` = only fast-forward, no merge commit

---

### `git pull --ff-only origin main`
**Syntax**
```bash
git pull --ff-only origin main
```

**What it does**  
Pulls the latest `main` branch from GitHub and updates the current branch only if the move is a fast-forward.

**Why we run it**  
This is the standard deployment update when the server is following `main`.

**Parameters**
- `origin` = remote name
- `main` = remote branch name
- `--ff-only` = only fast-forward

---

### `git push -u origin course`
**Syntax**
```bash
git push -u origin course
```

**What it does**  
Pushes your local `course` branch to GitHub and sets the upstream tracking relationship.

**Why we run it**  
We used this to publish `course` to GitHub for the first time.

**Parameters**
- `-u` or `--set-upstream` = remember the remote branch as the upstream
- `origin` = remote name
- `course` = local branch to push

---

### `git push origin release-01-ubuntu-service`
**Syntax**
```bash
git push origin release-01-ubuntu-service
```

**What it does**  
Pushes a specific tag to GitHub.

**Why we run it**  
Tags do not always move with a normal branch push. If you want the release tag on GitHub, push it explicitly.

**Parameters**
- `origin` = remote name
- `release-01-ubuntu-service` = tag name

---

### `git tag --list`
**Syntax**
```bash
git tag --list
```

**What it does**  
Lists all tags in the repository.

**Why we run it**  
Useful to confirm that your release tags exist.

**Parameters**
- `--list` = list tags

---

### `git tag -a release-01-ubuntu-service -m "Release 1.0 - Initial Ubuntu deployment"`
**Syntax**
```bash
git tag -a release-01-ubuntu-service -m "Release 1.0 - Initial Ubuntu deployment"
```

**What it does**  
Creates an annotated tag named `release-01-ubuntu-service`.

**Why we run it**  
Annotated tags are better for official releases because they store metadata and a message.

**Parameters**
- `-a` = annotated tag
- `release-01-ubuntu-service` = tag name
- `-m` = tag message

---

### `git show release-01-ubuntu-service`
**Syntax**
```bash
git show release-01-ubuntu-service
```

**What it does**  
Shows the tag message and the commit the tag points to.

**Why we run it**  
Helpful for verifying that a release tag points to the commit you intended.

**Parameters**
- `release-01-ubuntu-service` = tag name to inspect

---

## Advanced commands

### `git stash push -u -m "WIP toward release 2"`
**Syntax**
```bash
git stash push -u -m "WIP toward release 2"
```

**What it does**  
Temporarily saves uncommitted changes and returns the working tree to a clean state.

**Why we run it**  
We used this when we needed to preserve Release 2 work before moving the `course` branch back to a Release 1 checkpoint.

**Parameters**
- `push` = save the changes into a stash entry
- `-u` = include untracked files
- `-m` = add a descriptive stash message

---

### `git stash list`
**Syntax**
```bash
git stash list
```

**What it does**  
Shows saved stash entries.

**Why we run it**  
Helpful when you need to see what WIP snapshots are available to restore.

**Parameters**
- none required

---

### `git stash pop`
**Syntax**
```bash
git stash pop
```

**What it does**  
Restores the most recent stash and removes it from the stash list.

**Why we run it**  
Useful when you want to bring back work you temporarily set aside.

**Parameters**
- none required

---

### `git reset --hard 95aec66`
**Syntax**
```bash
git reset --hard 95aec66
```

**What it does**  
Moves the current branch and working tree to a specific commit and discards uncommitted changes.

**Why we run it**  
We used this to move the `course` branch back to the Release 1 checkpoint.

**Parameters**
- `--hard` = change both the branch pointer and the working tree
- `95aec66` = commit hash to reset to

**Warning**  
This is destructive if you have uncommitted changes.

---

### `git rev-parse HEAD`
**Syntax**
```bash
git rev-parse HEAD
```

**What it does**  
Prints the full commit hash of the current `HEAD`.

**Why we run it**  
Use this before deployment or tagging so you know exactly which commit is checked out.

**Parameters**
- `HEAD` = the current commit reference

---

### `git rev-parse --short HEAD`
**Syntax**
```bash
git rev-parse --short HEAD
```

**What it does**  
Prints a short version of the current commit hash.

**Why we run it**  
Easier to read and write down than the full SHA-1 hash.

**Parameters**
- `--short` = abbreviated commit hash
- `HEAD` = current commit reference

---

### `git ls-files node_modules | wc -l`
**Syntax**
```bash
git ls-files node_modules | wc -l
```

**What it does**  
Counts how many files Git is tracking under `node_modules`.

**Why we run it**  
We used this to confirm that `node_modules` is not committed.

**Parameters**
- `git ls-files node_modules` = list tracked files in `node_modules`
- `wc -l` = count the lines

---

### `git rm -r --cached node_modules`
**Syntax**
```bash
git rm -r --cached node_modules
```

**What it does**  
Stops Git from tracking files in `node_modules` without deleting them from your local disk.

**Why we run it**  
Use this when a project accidentally committed `node_modules` and you want to clean the repository.

**Parameters**
- `-r` = recursive
- `--cached` = remove from Git tracking only, not from the filesystem

**Warning**  
This changes the repository state and should be used carefully.

---

### `git branch -D course`
**Syntax**
```bash
git branch -D course
```

**What it does**  
Forcibly deletes the local `course` branch.

**Why we run it**  
We discussed this as an option, but generally did not need it.

**Parameters**
- `-D` = force delete the branch

**Warning**  
This can remove a branch name locally even if it has unmerged work.

---

### `git push origin course:main`
**Syntax**
```bash
git push origin course:main
```

**What it does**  
Forces a push from your local `course` branch into the remote `main` branch.

**Why we mention it**  
This is the kind of command you should be careful not to run unless you intentionally want to update remote `main`.

**Parameters**
- `course:main` = local branch on the left, remote branch on the right

**Warning**  
This can overwrite the remote branch if the remote accepts it.

---

### `git push origin HEAD:main`
**Syntax**
```bash
git push origin HEAD:main
```

**What it does**  
Pushes the current checked-out commit into remote `main`.

**Why we mention it**  
This is another explicit way to target `main` on the remote.

**Parameters**
- `HEAD:main` = current commit on the left, remote branch `main` on the right

**Warning**  
Like the previous command, this is not something to use casually.

---

### `git remote set-url origin git@github-cougarcalc:byumerrill/cougarcalc.git`
**Syntax**
```bash
git remote set-url origin git@github-cougarcalc:byumerrill/cougarcalc.git
```

**What it does**  
Changes the `origin` remote to use the SSH alias configured for the CougarCalc deploy key.

**Why we run it**  
Useful if the deployment clone accidentally points directly at `git@github.com` instead of the deploy-key alias.

**Parameters**
- `set-url` = change the remote URL
- `origin` = remote name
- SSH URL = new remote target

---

### `git log --reverse --oneline`
**Syntax**
```bash
git log --reverse --oneline
```

**What it does**  
Shows the commit history from oldest to newest in compact form.

**Why we run it**  
Helpful when you are trying to locate the first commit that belongs to Release 1 or Release 2.

**Parameters**
- `--reverse` = show oldest commits first
- `--oneline` = compact format

---

### `git show <tag>`
**Syntax**
```bash
git show release-01-ubuntu-service
```

**What it does**  
Shows the tagged commit, tag message, and associated diff details.

**Why we run it**  
Useful for checking exactly what the release tag points to.

**Parameters**
- `<tag>` = the tag name you want to inspect

---

## A simple rule of thumb

Use the **common commands** every day:

- `status`
- `branch`
- `log`
- `fetch`
- `pull --ff-only`
- `push -u`
- `tag -a`

Use the **advanced commands** when you are:
- cleaning up release branches
- recovering work
- troubleshooting deployment
- correcting repository history
- checking exact commit hashes

---

## Best habits for IS 404

- Check `git status` before and after changes.
- Know which branch you are on.
- Use `git pull --ff-only` on deployment servers.
- Tag official releases after validation.
- Keep `main` and `course` roles clear.
- Avoid editing deployment clones directly.
- Treat tags as release checkpoints, not moving targets.
