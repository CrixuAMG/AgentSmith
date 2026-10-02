import fuzzysort from 'fuzzysort';

import type { ProjectFileNode } from '@/shared/types';

export interface SearchEntry {
  node: ProjectFileNode;
  label: string;
}

export function indexProjectTree(nodes: ProjectFileNode[]): SearchEntry[] {
  return nodes.flatMap((node) => [
    { node, label: node.relativePath },
    ...(node.children ? indexProjectTree(node.children) : []),
  ]);
}

export function fuzzySearch(entries: SearchEntry[], query: string): ProjectFileNode[] {
  if (!query.trim()) return [];
  return fuzzysort.go(query, entries, { key: 'label', limit: 80 }).map((result) => result.obj.node);
}
