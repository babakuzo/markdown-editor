'use client';

import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {DraggableBlockPlugin_EXPERIMENTAL} from '@lexical/react/LexicalDraggableBlockPlugin';
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  type MenuTextMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin';
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  type ElementNode,
  type LexicalEditor,
  type TextNode,
} from 'lexical';
import {$setBlocksType} from '@lexical/selection';
import {$createHeadingNode, $createQuoteNode} from '@lexical/rich-text';
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from '@lexical/list';
import {$createCodeNode} from '@lexical/code';
import {INSERT_TABLE_COMMAND} from '@lexical/table';
import {INSERT_HORIZONTAL_RULE_COMMAND} from '@lexical/extension';
import {Card} from '@astryxdesign/core/Card';
import {List, ListItem} from '@astryxdesign/core/List';
import {Icon} from '@astryxdesign/core/Icon';
import {IconButton} from '@astryxdesign/core/IconButton';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/Stack';
import {
  Bars3BottomLeftIcon,
  ChatBubbleBottomCenterTextIcon,
  CodeBracketIcon,
  ListBulletIcon,
  MinusIcon,
  NumberedListIcon,
  TableCellsIcon,
  H1Icon,
  H2Icon,
  CheckCircleIcon,
  EllipsisVerticalIcon,
} from '@heroicons/react/24/outline';

export type Sticker = 'coral' | 'tape' | 'sage' | 'sky' | 'stone';

/* ------------------------------------------------------------------------ */
/* The blocks a person can add. Same list feeds the sticker tray and "/".    */
/* ------------------------------------------------------------------------ */

export class InsertOption extends MenuOption {
  title: string;
  description: string;
  glyph: typeof H1Icon;
  sticker: Sticker;
  keywords: string[];
  inTray: boolean;
  run: (editor: LexicalEditor) => void;
  constructor(o: {
    title: string;
    description: string;
    glyph: typeof H1Icon;
    sticker: Sticker;
    keywords: string[];
    inTray?: boolean;
    run: (editor: LexicalEditor) => void;
  }) {
    super(o.title);
    this.title = o.title;
    this.description = o.description;
    this.glyph = o.glyph;
    this.sticker = o.sticker;
    this.keywords = o.keywords;
    this.inTray = o.inTray ?? true;
    this.run = o.run;
  }
}

function setBlock(editor: LexicalEditor, create: () => ElementNode) {
  editor.update(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      $setBlocksType(selection, create);
    }
  });
}

export function buildOptions(): InsertOption[] {
  return [
    new InsertOption({title: 'Title', description: 'The big heading at the top', glyph: H1Icon, sticker: 'coral', keywords: ['h1', 'title', 'heading'], run: e => setBlock(e, () => $createHeadingNode('h1'))}),
    new InsertOption({title: 'Section', description: 'Start a new part', glyph: H2Icon, sticker: 'coral', keywords: ['h2', 'h3', 'heading', 'section'], run: e => setBlock(e, () => $createHeadingNode('h2'))}),
    new InsertOption({title: 'Text', description: 'A normal paragraph', glyph: Bars3BottomLeftIcon, sticker: 'stone', keywords: ['paragraph', 'body', 'text', 'normal'], inTray: false, run: e => setBlock(e, () => $createParagraphNode())}),
    new InsertOption({title: 'List', description: 'Points with bullets', glyph: ListBulletIcon, sticker: 'tape', keywords: ['ul', 'bullets', 'list'], run: e => e.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}),
    new InsertOption({title: 'Steps', description: 'A numbered list', glyph: NumberedListIcon, sticker: 'tape', keywords: ['ol', 'numbers', 'steps', 'numbered'], inTray: false, run: e => e.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)}),
    new InsertOption({title: 'To-do', description: 'Boxes you can tick', glyph: CheckCircleIcon, sticker: 'sage', keywords: ['todo', 'task', 'check', 'checklist'], run: e => e.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined)}),
    new InsertOption({title: 'Table', description: 'Rows and columns', glyph: TableCellsIcon, sticker: 'sky', keywords: ['grid', 'table', 'columns'], run: e => e.dispatchCommand(INSERT_TABLE_COMMAND, {rows: '3', columns: '3', includeHeaders: {rows: true, columns: false}})}),
    new InsertOption({title: 'Quote', description: 'Set a passage apart', glyph: ChatBubbleBottomCenterTextIcon, sticker: 'stone', keywords: ['blockquote', 'quote'], run: e => setBlock(e, () => $createQuoteNode())}),
    new InsertOption({title: 'Code', description: 'For commands or code', glyph: CodeBracketIcon, sticker: 'stone', keywords: ['code', 'snippet', 'command'], inTray: false, run: e => setBlock(e, () => $createCodeNode())}),
    new InsertOption({title: 'Divider', description: 'A line between parts', glyph: MinusIcon, sticker: 'stone', keywords: ['hr', 'divider', 'line', 'rule'], inTray: false, run: e => e.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined)}),
  ];
}

export function formatText(editor: LexicalEditor, format: 'bold' | 'italic') {
  editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
}

/* ------------------------------------------------------------------------ */
/* Type "/" on an empty line to insert. Never fires inside a word or line.   */
/* ------------------------------------------------------------------------ */

function slashAtLineStart(text: string): MenuTextMatch | null {
  const m = /^\/([A-Za-z-]{0,20})$/.exec(text);
  if (!m) return null;
  return {leadOffset: 0, matchingString: m[1], replaceableString: m[0]};
}

export function SlashInsertPlugin() {
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState<string | null>(null);
  const all = useMemo(buildOptions, []);
  const options = useMemo(() => {
    if (!query) return all;
    const q = query.toLowerCase();
    return all.filter(o => o.title.toLowerCase().includes(q) || o.keywords.some(k => k.includes(q)));
  }, [all, query]);

  const triggerFn = useCallback((text: string) => slashAtLineStart(text), []);

  const onSelectOption = useCallback(
    (option: InsertOption, textNode: TextNode | null, closeMenu: () => void) => {
      editor.update(() => {
        textNode?.remove();
      });
      option.run(editor);
      closeMenu();
    },
    [editor],
  );

  return (
    <LexicalTypeaheadMenuPlugin<InsertOption>
      onQueryChange={setQuery}
      onSelectOption={onSelectOption}
      triggerFn={triggerFn}
      options={options}
      menuRenderFn={(anchorElementRef, {selectedIndex, selectOptionAndCleanUp, setHighlightedIndex}) =>
        anchorElementRef.current && options.length > 0
          ? createPortal(
              <Card padding={1} elevation="med" width={260} className="notr-slash">
                <VStack gap={1}>
                  <Text type="supporting" color="secondary">
                    Add to the page
                  </Text>
                  <List density="compact">
                    {options.map((option, i) => (
                      <ListItem
                        key={option.key}
                        label={option.title}
                        description={option.description}
                        isSelected={selectedIndex === i}
                        startContent={
                          <span className={`notr-dot notr-sticker-${option.sticker}`} aria-hidden="true">
                            <Icon icon={option.glyph} size="sm" />
                          </span>
                        }
                        onClick={() => {
                          setHighlightedIndex(i);
                          selectOptionAndCleanUp(option);
                        }}
                      />
                    ))}
                  </List>
                </VStack>
              </Card>,
              anchorElementRef.current,
            )
          : null
      }
    />
  );
}

/* ------------------------------------------------------------------------ */
/* Drag handle in the page margin                                            */
/* ------------------------------------------------------------------------ */

const DRAG_MENU_CLASS = 'notr-drag-menu';

function isOnMenu(element: HTMLElement): boolean {
  return Boolean(element.closest(`.${DRAG_MENU_CLASS}`));
}

export function DragHandlePlugin() {
  const [editor] = useLexicalComposerContext();
  const [anchorElem, setAnchorElem] = useState<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const targetLineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return editor.registerRootListener(root => {
      const anchor = (root?.closest('.notr-page') as HTMLElement | null) ?? root?.parentElement ?? null;
      anchor?.classList.add('notr-editor-anchor');
      setAnchorElem(anchor);
    });
  }, [editor]);

  if (anchorElem == null) return null;

  const menu: ReactNode = (
    <div ref={menuRef} className={DRAG_MENU_CLASS}>
      <IconButton
        label="Drag to move this block"
        tooltip="Drag to move"
        variant="ghost"
        size="sm"
        icon={<Icon icon={EllipsisVerticalIcon} />}
      />
    </div>
  );

  return (
    <DraggableBlockPlugin_EXPERIMENTAL
      anchorElem={anchorElem}
      menuRef={menuRef}
      targetLineRef={targetLineRef}
      menuComponent={menu}
      targetLineComponent={<div ref={targetLineRef} className="notr-drop-line" />}
      isOnMenu={isOnMenu}
    />
  );
}
