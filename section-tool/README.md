# Hebrew Text Sectioning Tool

A keyboard-driven Angular tool for progressively dividing Hebrew text into nested JSON sections with a recursive, intuitive interface.

## Features

- **Keyboard-Driven Workflow**: Fast section creation using keyboard shortcuts
- **Progressive Splitting**: Text automatically moves into separate inputs as you divide it
- **Flexible Hierarchy**: Unlimited recursive nesting - any section can contain subsections
- **RTL Support**: Full Hebrew text support with right-to-left layout
- **Visual Nesting**: See your document structure with indented text inputs
- **Real-time JSON Preview**: Live JSON output as you work
- **Optional Labels**: Add labels to any section for easier identification

## Getting Started

### Installation

```bash
yarn install
```

### Running the Application

```bash
yarn start
```

Open your browser at `http://localhost:4200/`

## How to Use

### The Workflow

1. **Paste your Hebrew text** into the initial text area
2. **Place cursor** at the point where you want to split
3. **Press a keyboard shortcut**:
   - **Enter**: Move the lines from the cursor on into a **child subsection**
   - **Tab**: Move the lines from the cursor on into a **sibling section**
   - **Alt+Enter**: Move the lines from the cursor on into a section after the **parent**
   - **Shift+Enter**: Merge current section back into its parent
   - **Shift+Tab**: Merge current section with previous sibling

### Key Concepts

- **Text is made of lines.** Each line has a stable ID that audio alignments point at. A split never cuts a line: with the cursor at the end of a line the split goes after it; anywhere else in a line, that line moves to the new section.
- **Editing keeps line IDs.** Fixing a line keeps its ID; a new line gets a new one; a deleted line's ID is gone. Pasted or typed lines get fresh IDs. Joining two lines gives the result a new ID. A line that comes back in the same session (undo, cut and paste, drag and drop, moving it to another section) gets its old ID back.
- **Saving is guarded.** Saving refuses to overwrite a chapter that changed in the repository since you loaded it (reload first), and asks before saving a file whose lines had to be given new IDs on load.
- **Child vs Sibling**:
  - Child (Enter) = nested inside current section
  - Sibling (Tab) = same level as current section
- **Progressive Division**: As you split text, each piece gets its own text input
- **Labels**: Click "Click to add label" to name any section

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Enter** | Split into child subsection |
| **Tab** | Split into sibling section |
| **Alt+Enter** | Split and promote to the parent's sibling |
| **Shift+Enter** | Merge with parent |
| **Shift+Tab** | Merge with previous sibling |

## Interface Elements

- **Level Indicator**: Shows nesting depth (Level 1, Level 2, etc.)
- **Label Field**: Click to add/edit labels for sections
- **Delete Button (×)**: Remove a section and its children
- **Text Area**: Where you work with text - focus and use keyboard shortcuts
- **JSON Output**: Live preview of the chapter JSON

## Tips

- Start with larger divisions (chapters) and progressively break down into smaller sections
- Use labels for sections you'll need to identify later
- The cursor position matters - the line it is in, and everything after, is what moves
- You can always merge sections back together if you divide incorrectly
- Empty sections and blank lines are automatically excluded from the JSON output

## Technical Details

- Angular 21 with Zoneless Change Detection
- One service holds the document in a signal; every edit is a command handled by a pure, unit-tested function (see [ARCHITECTURE.md](ARCHITECTURE.md))
- Recursive component structure mirrors the section hierarchy
- Output is a `TextNode[]` JSON array matching `data/schema/v1/chapter.schema.json`

## Export

- **Copy**: Copy JSON to clipboard
- **Download**: Save as a .json file
- **Save**: Commit the chapter to `data/chapters/` on GitHub, in the file's own layout (indent, trailing newline), so the commit shows only what changed. Both the editor and the save function refuse a chapter whose lines lack valid, unique IDs.

## License

ISC
