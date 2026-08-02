import * as path from "path";
const changes = new Map();
let worktreeRoot = "";
export function initStore(worktree) {
    worktreeRoot = worktree || process.cwd();
}
function toRelative(p) {
    if (!p)
        return "";
    const normalized = path.normalize(p);
    if (path.isAbsolute(normalized) && worktreeRoot) {
        const rel = path.relative(worktreeRoot, normalized);
        return rel.startsWith("..") ? normalized : rel;
    }
    return normalized;
}
export function recordChange(filePath, type) {
    const rel = toRelative(filePath);
    if (!rel)
        return;
    changes.set(rel, type);
}
export function getChanges() {
    return new Map(changes);
}
export function clearChanges() {
    changes.clear();
}
function addToTree(children, segs, fullPath, changeType) {
    if (segs.length === 0)
        return;
    const [head, ...rest] = segs;
    let child = children.find((c) => c.name === head);
    if (rest.length === 0) {
        if (child) {
            child.changeType = changeType;
            child.path = fullPath;
        }
        else {
            children.push({ name: head, path: fullPath, changeType, children: [] });
        }
        return;
    }
    if (!child) {
        const dirPath = segs.slice(0, -rest.length).join(path.sep);
        child = { name: head, path: dirPath, children: [] };
        children.push(child);
    }
    addToTree(child.children, rest, fullPath, changeType);
}
export function buildTree(filter) {
    const root = [];
    for (const [relPath, changeType] of changes) {
        if (filter && changeType !== filter)
            continue;
        const segs = relPath.split(path.sep).filter(Boolean);
        if (segs.length === 0)
            continue;
        addToTree(root, segs, relPath, changeType);
    }
    function sortNodes(nodes) {
        return [...nodes].sort((a, b) => {
            const aIsFile = a.changeType !== undefined;
            const bIsFile = b.changeType !== undefined;
            if (aIsFile !== bIsFile)
                return aIsFile ? 1 : -1;
            return a.name.localeCompare(b.name);
        }).map((n) => ({ ...n, children: sortNodes(n.children) }));
    }
    return sortNodes(root);
}
export function getChangedPaths(filter) {
    const list = [];
    for (const [p, t] of changes) {
        if (filter && t !== filter)
            continue;
        list.push({ path: p, changeType: t });
    }
    list.sort((a, b) => a.path.localeCompare(b.path));
    return list;
}
export function hasChanges() {
    return changes.size > 0;
}
//# sourceMappingURL=changed-files-store.js.map