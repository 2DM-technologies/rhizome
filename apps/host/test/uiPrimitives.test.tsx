import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ElementPreview, EntityRow, FilePicker, SearchField, TextInput } from "../src/ui/index.ts";

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
