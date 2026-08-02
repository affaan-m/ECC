export type ChangeType = "added" | "modified" | "deleted";
export declare function initStore(worktree: string): void;
export declare function recordChange(filePath: string, type: ChangeType): void;
export declare function getChanges(): Map<string, ChangeType>;
export declare function clearChanges(): void;
export type TreeNode = {
    name: string;
    path: string;
    changeType?: ChangeType;
    children: TreeNode[];
};
export declare function buildTree(filter?: ChangeType): TreeNode[];
export declare function getChangedPaths(filter?: ChangeType): Array<{
    path: string;
    changeType: ChangeType;
}>;
export declare function hasChanges(): boolean;
//# sourceMappingURL=changed-files-store.d.ts.map