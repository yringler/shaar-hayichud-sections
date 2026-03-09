# Claude Code Instructions

This is a Hebrew text sectioning tool built with Angular 21. It helps users progressively divide Hebrew text into nested XML sections using keyboard shortcuts.

## Project Overview

**Purpose**: Progressive Hebrew text sectioning tool with keyboard-driven workflow
**Tech Stack**: Angular 21, TypeScript, Signals (zoneless), Vitest
**Architecture**: Signal-based reactive state, recursive component structure

## Code Style & Conventions

### Angular Patterns
- **Standalone Components**: All components use standalone: true
- **Signals for State**: Use Angular signals, not RxJS subjects, for state management
- **Zoneless Change Detection**: No Zone.js - signals drive all reactivity
- **Signal-based Inputs**: Use `input.required<T>()` and `input<T>(defaultValue)`
- **Signal-based Outputs**: Use `output<T>()` for events
- **Computed Signals**: Use `computed()` for derived state (e.g., XML output)

### TypeScript
- **Strict Mode**: TypeScript strict mode enabled
- **Type Everything**: Explicit types for all parameters, return values, and variables
- **Interfaces for Events**: Custom event types for component communication
- **Type Guards**: Use type guards (e.g., `isString()`, `isTextNode()`) for discriminated unions

### Testing
- **Framework**: Vitest (not Jest or Karma)
- **Coverage**: Comprehensive unit tests for all service methods
- **Test Pattern**: Given-When-Then structure in test descriptions
- **Angular Testing**: Use TestBed for Angular-specific tests

## Key Architectural Decisions

### Mixed Content Model (Current)
The `TextNode` model supports **interleaved text and child sections**:

```typescript
interface TextNode {
  id: string;
  label: string;
  children: (TextNode | string)[];  // Mixed content array
  text?: string;  // Deprecated, kept for backward compatibility
}
```

**Rationale**: Allows text before, after, and between child sections (like real documents).

**Example**:
```typescript
{
  label: "Chapter",
  children: [
    "Introduction text",
    childSection1,
    "Transitional text",
    childSection2,
    "Conclusion"
  ]
}
```

### Service Methods Pattern

All mutation methods follow this pattern:
1. Accept `contentIndex` parameter to identify which text segment
2. Use `mutateNode()` helper for state updates
3. Call `this.rootNodes.set([...roots])` to trigger reactivity
4. Return the ID of newly focused node (or null)

**Example**:
```typescript
splitToChild(nodeId: string, contentIndex: number, cursorPos: number): string | null {
  let newId: string | null = null;
  this.mutateNode(nodeId, (node) => {
    // Mutation logic here
    const newChild = this.createNode(afterCursor);
    newId = newChild.id;
    node.children.splice(contentIndex, 1, beforeCursor, newChild);
  });
  return newId;
}
```

### XML Generation

The `nodesToXml()` method handles three cases:
1. **Text-only nodes**: Inline format `<section>text</section>`
2. **Empty nodes**: Skipped entirely
3. **Nodes with children**: Multi-line format with indentation

**Important**: Adjacent text strings are automatically merged during merge operations via `mergeAdjacentStrings()`.

## File Organization

```
src/app/
├── models/
│   └── text-node.model.ts           # Core data model
├── services/
│   ├── text-section.service.ts      # State management (signals)
│   ├── text-section.service.spec.ts # Service tests (47 tests)
│   ├── xml-parser.service.ts        # XML parsing and loading
│   └── xml-parser.service.spec.ts   # Parser tests (12 tests)
├── components/
│   ├── text-node/                   # Recursive node component
│   │   ├── text-node.component.ts
│   │   ├── text-node.component.html
│   │   └── text-node.component.css
│   └── xml-output/                  # Output panel
│       ├── xml-output.component.ts
│       ├── xml-output.component.html
│       └── xml-output.component.css
└── text-sectioner/                  # Main container
    ├── text-sectioner.component.ts
    ├── text-sectioner.component.html
    └── text-sectioner.component.css
```

## Development Guidelines

### Adding New Features

1. **Start with the model** - Update `TextNode` if data structure changes
2. **Update the service** - Add/modify methods in `TextSectionService`
3. **Write tests first** - Update `text-section.service.spec.ts` with expected behavior
4. **Update components** - Modify components to use new service methods
5. **Run tests** - Ensure all 59 tests pass: `npm test`

### Testing Requirements

- **All service methods must have tests**
- **Test edge cases**: empty strings, empty arrays, null returns
- **Test reactivity**: Verify signals update correctly
- **Test XML output**: Validate generated XML structure
- **Run tests before committing**: `npm test -- --watch=false`

### Common Operations

**Run dev server**:
```bash
npm start
```

**Run tests**:
```bash
npm test
```

**Build for production**:
```bash
npm run build
```

**Type checking**:
```bash
npx tsc --noEmit
```

## Important Patterns to Follow

### 1. Signal Updates
Always use immutable updates to trigger reactivity:
```typescript
// ✅ Good - creates new array reference
this.rootNodes.set([...roots]);

// ❌ Bad - mutates existing array, no reactivity
this.rootNodes().push(newNode);
```

### 2. Type Guards for Mixed Content
Use helper methods for type checking:
```typescript
private isTextNode(item: TextNode | string): item is TextNode {
  return typeof item !== 'string';
}
```

### 3. Event Bubbling
Events bubble up from child components:
```typescript
// Child emits event
this.textChange.emit({ nodeId, contentIndex, text });

// Parent re-emits to bubble up
onChildTextChange(event: NodeTextChangeEvent): void {
  this.textChange.emit(event);
}

// Container handles event
onTextChange(event: NodeTextChangeEvent): void {
  this.service.updateNodeText(event.nodeId, event.contentIndex, event.text);
}
```

### 4. Focus Management
After operations that create new nodes, focus is managed via:
```typescript
if (focusId) {
  requestAnimationFrame(() => {
    const el = document.querySelector(`textarea[data-node-id="${focusId}"]`);
    el?.focus();
  });
}
```

## Common Pitfalls to Avoid

1. **Don't forget `contentIndex`** - All text operations need it to identify which segment
2. **Don't skip `mergeAdjacentStrings()`** - Call after operations that might create adjacent strings
3. **Don't use `node.text`** - Use `node.children[0]` instead (text is deprecated)
4. **Don't mutate arrays directly** - Always create new arrays for signal updates
5. **Don't skip empty string handling** - Some operations need to preserve empty strings for structure

## RTL Support

The application supports Hebrew (RTL) text:
- Textareas use `dir="rtl"` attribute
- CSS handles RTL layout with `margin-right` for indentation
- No special logic needed in TypeScript - browser handles RTL

## XML Output Format

Generated XML uses:
- `<section>` tags for all nodes
- `label` attribute for labeled sections
- Proper indentation (2 spaces per level)
- Escaped special characters (&, <, >, ")
- Trimmed text content
- Skipped empty nodes
- **Root wrapper**: Always wrapped in a root `<section>` element for valid XML

**Example**:
```xml
<section>
  <section label="Chapter 1">
    Introduction text
    <section label="Section 1.1">
      Section content
      <section>Subsection content</section>
    </section>
    Conclusion text
  </section>
</section>
```

### XML Parsing (Loading)

When XML is loaded/pasted:
- The parser automatically **unwraps** a wrapper root `<section>` (no label, no text content)
- This ensures roundtrip compatibility: generate → copy → paste → edit → generate
- Root sections with labels or text content are preserved as actual content nodes
- This allows users to paste generated XML without creating double-wrapped structures

### Blank XML for Empty State

When the application is in its initial state (single empty node with no content):
- `xmlOutput()` returns an empty string `''`
- This allows users to paste XML directly without clearing first
- Once any content is added, normal XML output is generated

## When Making Changes

1. **Read existing tests first** - Understand expected behavior
2. **Update tests if behavior changes** - Keep tests in sync
3. **Maintain backward compatibility** - Don't break existing functionality
4. **Follow established patterns** - Consistency is key
5. **Test manually** - Run the app and verify UI works correctly

## Keyboard Shortcuts (User-Facing)

- **Enter**: Split into child section
- **Tab**: Split into sibling section
- **Alt+Enter**: Split and promote to parent's sibling (one level up)
- **Shift+Enter**: Merge with parent
- **Shift+Tab**: Merge with previous sibling

These are implemented in `text-sectioner.component.ts` via the `onNodeKeydown()` handler.

## Recent Changes

**2026-02-17**: Added root XML wrapper for valid XML output
- XML output now always wrapped in root `<section>` element (when not empty)
- Empty default state returns blank XML for easy pasting
- Parser automatically unwraps wrapper roots when loading
- Added 12 tests for XML parser (59 total tests)
- Ensures roundtrip compatibility

**2026-02-16**: Implemented interleaved text and children support
- Changed `children: TextNode[]` to `children: (TextNode | string)[]`
- Added `contentIndex` parameter to all text operations
- Rewrote `nodesToXml()` for mixed content rendering
- All 44 tests updated and passing ✅

See `IMPLEMENTATION_SUMMARY.md` for detailed migration notes.