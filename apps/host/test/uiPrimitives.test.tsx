import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ElementPreview,
  EntityRow,
  FilePicker,
  ReferenceCard,
  SearchField,
  SelectInput,
  TextArea,
  TextInput,
} from "../src/ui/index.ts";

test("renders SearchField as a reusable embedded search input", () => {
  const markup = renderToStaticMarkup(
    <SearchField surface="embedded" aria-label="Search everything" aria-expanded />,
  );

  expect(markup).toContain('data-search-field="true"');
  expect(markup).toContain('data-surface="embedded"');
  expect(markup).toContain('type="search"');
  expect(markup).toContain('aria-label="Search everything"');
  expect(markup).not.toContain("bg-dock-search");
});

test("renders shared text and file inputs with native form controls", () => {
  const text = renderToStaticMarkup(
    <TextInput name="token" type="password" typography="mono" tone="canvas" />,
  );
  const file = renderToStaticMarkup(<FilePicker name="export" accept=".csv" required />);

  expect(text).toContain('type="password"');
  expect(text).toContain('name="token"');
  expect(file).toContain('type="file"');
  expect(file).toContain('name="export"');
  expect(file).toContain("data-file-picker-dropzone");
  expect(file).toContain("Drop a file here");
  expect(file).toContain("Choose a file");
});

test("renders native selects with a centered custom caret and medium radius", () => {
  const markup = renderToStaticMarkup(
    <SelectInput aria-label="Import source" defaultValue="arena">
      <option value="arena">Are.na</option>
    </SelectInput>,
  );

  expect(markup).toContain("<select");
  expect(markup).toContain("appearance-none");
  expect(markup).toContain("rounded-md");
  expect(markup).toContain("data-select-input-caret");
});

test("supports borderless text areas without changing the default", () => {
  const borderless = renderToStaticMarkup(<TextArea bordered={false} />);
  const bordered = renderToStaticMarkup(<TextArea />);

  expect(borderless).not.toContain("border-hairline");
  expect(bordered).toContain("border-hairline");
});

test("renders selectable entity rows with an accessible native button", () => {
  const markup = renderToStaticMarkup(
    <EntityRow
      title="Love always wins"
      meta="12 objects"
      onSelect={() => undefined}
      selectLabel="Open Vibe"
    />,
  );

  expect(markup).toContain("<button");
  expect(markup).toContain('aria-label="Open Vibe"');
  expect(markup).toContain("Love always wins");
});

test("renders browser-native element previews through the shared media component", () => {
  const markup = renderToStaticMarkup(
    <ElementPreview title="Preview" kind="image" mime="image/png" src="/preview.png" />,
  );

  expect(markup).toContain('data-element-presentation="image"');
  expect(markup).toContain('src="/preview.png"');
  expect(markup).toContain('alt="Preview"');
});

test("renders text payloads as inert UTF-8 text instead of iframe documents", () => {
  const markup = renderToStaticMarkup(
    <ElementPreview title="Post" kind="text" mime="text/plain" src="blob:post" />,
  );

  expect(markup).toContain("<pre");
  expect(markup).toContain('data-element-presentation="text"');
  expect(markup).toContain('title="Text content for Post"');
  expect(markup).not.toContain("<iframe");
});

test("frames every detailed native element preview with the shared hairline", () => {
  for (const [kind, mime] of [
    ["image", "image/png"],
    ["audio", "audio/mpeg"],
    ["video", "video/mp4"],
    ["text", "text/plain"],
    ["document", "application/pdf"],
  ] as const) {
    const markup = renderToStaticMarkup(
      <ElementPreview
        title={`${kind} preview`}
        kind={kind}
        mime={mime}
        src={`/preview.${kind}`}
        variant="detail"
      />,
    );

    expect(markup).toContain("border-hairline");
  }
});

test("supports the secondary accent for nested element cards and previews", () => {
  const card = renderToStaticMarkup(
    <ReferenceCard
      label="element 1"
      reference="rnet://element/example"
      borderTone="accent-secondary"
    />,
  );
  const preview = renderToStaticMarkup(
    <ElementPreview
      title="Image preview"
      kind="image"
      mime="image/png"
      src="/preview.png"
      variant="detail"
      borderTone="accent-secondary"
    />,
  );

  expect(card).toContain("border-accent-secondary");
  expect(preview).toContain("border-accent-secondary");
  expect(card).not.toContain("border-hairline");
  expect(preview).not.toContain("border-hairline");
});
