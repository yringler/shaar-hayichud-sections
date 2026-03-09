# Architecture

This project uses Angular 21 with zoneless change detection, signals for reactive state management, and is split into modular components.

## Component Structure

### Services

**`TextSectionService`** (`src/app/services/text-section.service.ts`)
- Manages application state using Angular signals
- `rootNodes`: signal containing the tree of text nodes
- `xmlOutput`: computed signal that automatically generates XML from nodes
- Methods for CRUD operations on nodes (create, delete, merge, update)

### Components

**`TextSectionerComponent`** (Main Container)
- Top-level orchestrator component
- Handles keyboard shortcuts and delegates to service
- Minimal logic - mostly event handling and routing to service

**`TextNodeComponent`** (Recursive)
- Represents a single text node with its children
- Uses signal-based inputs for reactivity
- Emits events for user actions (keydown, text change, label edit, delete)
- Recursively renders child nodes
- Completely presentational - no business logic

**`XmlOutputComponent`** (Output Panel)
- Displays generated XML
- Provides copy/download/clear actions
- Simple, focused component

## Reactive Architecture

### Signals Usage
- **`rootNodes`** signal: Source of truth for document structure
- **`xmlOutput`** computed signal: Auto-updates when rootNodes change
- When any node is modified, the signal is updated via `.set([...array])` to trigger reactivity

### Event Flow
1. User interacts with TextNodeComponent (keyboard, input)
2. Event bubbles up to TextSectionerComponent
3. TextSectionerComponent calls appropriate service method
4. Service updates `rootNodes` signal
5. `xmlOutput` computed signal automatically recalculates
6. Angular updates all components reactively

## Benefits of This Architecture

1. **Separation of Concerns**: Business logic in service, presentation in components
2. **Reactivity**: Signals provide efficient, automatic UI updates
3. **Reusability**: TextNodeComponent is recursive and self-contained
4. **Testability**: Service can be tested independently
5. **Maintainability**: Small, focused components are easier to understand and modify

## File Structure

```
src/app/
├── services/
│   └── text-section.service.ts    # State management with signals
├── components/
│   ├── text-node/                  # Recursive node component
│   │   ├── text-node.component.ts
│   │   ├── text-node.component.html
│   │   └── text-node.component.css
│   └── xml-output/                 # Output panel component
│       ├── xml-output.component.ts
│       ├── xml-output.component.html
│       └── xml-output.component.css
└── text-sectioner/                 # Main container
    ├── text-sectioner.component.ts
    ├── text-sectioner.component.html
    └── text-sectioner.component.css
```

## Zoneless Change Detection

Angular 21 introduces official zoneless change detection support:
- No Zone.js dependency required
- Signals drive all reactive updates automatically
- Computed values (like XML output) update automatically
- More explicit data flow
- Better performance through fine-grained reactivity
- Smaller bundle size without Zone.js

## Future Improvements

- Could add effects for side effects (logging, analytics)
- Could implement undo/redo with signal history
- Could add async operations (save to server) with RxJS interop
