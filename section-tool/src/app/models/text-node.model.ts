/**
 * In-memory editor node. `id` exists only while editing: it is regenerated on
 * every load and never written to the chapter JSON.
 */
export interface TextNode {
  id: string;
  label: string;
  /** Mixed content: text strings and child sections, in document order. */
  children: Content[];
  translation?: string;
}

export type Content = TextNode | string;

export function isTextNode(item: Content | undefined): item is TextNode {
  return typeof item === 'object' && item !== null;
}

export function isText(item: Content | undefined): item is string {
  return typeof item === 'string';
}
