import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSharedDraft,
  findFirstUrl,
  normalizeRepositoryInput,
  uniqueRepositories
} from "../public/shared.js";

test("共有タイトル・本文・URLをIssue下書きへ変換する", () => {
  const draft = buildSharedDraft(new URLSearchParams({
    title: "役立ちそうな記事",
    text: "あとで実装に反映する",
    url: "https://example.com/posts/42"
  }));

  assert.deepEqual(draft, {
    title: "役立ちそうな記事",
    body: "あとで実装に反映す\n\n参照元: https://example.com/posts/42",
    sharedUrl: "https://example.com/posts/42"
  });
});

test("共有テキスト末尾のURLを本文から分離して重複を避ける", () => {
  const draft = buildSharedDraft("text=%E5%AF%BE%E5%BF%9C%E5%80%99%E8%A3%9C%0Ahttps%3A%2F%2Fx.com%2Fexample%2Fstatus%2F1");

  assert.equal(draft.title, "対応候補");
  assert.equal(draft.body, "対応候補\n\n参照元: https://x.com/example/status/1");
  assert.equal(draft.sharedUrl, "https://x.com/example/status/1");
});

test("URLだけが共有された場合はホスト名を仮タイトルにする", () => {
  const draft = buildSharedDraft({ text: "https://www.example.com/path" });

  assert.equal(draft.title, "example.com");
  assert.equal(draft.body, "参照元: https://www.example.com/path");
});

test("URL末尾の句読点を共有URLに含めない", () => {
  assert.equal(findFirstUrl("参照 https://example.com/path。"), "https://example.com/path");
  assert.equal(findFirstUrl("参照 https://example.com/path),"), "https://example.com/path");
});

test("登録リポジトリを検証し、重複を取り除く", () => {
  assert.equal(normalizeRepositoryInput(" azumag/EasyIssue "), "azumag/EasyIssue");
  assert.equal(normalizeRepositoryInput("https://github.com/azumag/EasyIssue"), "");
  assert.deepEqual(
    uniqueRepositories(["azumag/EasyIssue", "invalid", "azumag/EasyIssue", "openai/openai"]),
    ["azumag/EasyIssue", "openai/openai"]
  );
});
