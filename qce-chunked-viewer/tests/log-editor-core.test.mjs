import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/qce/log-core.js";

const C = globalThis.LogEditorCore;
const row = (id, uin, uid, name, text) => ({
  id: String(id),
  time: "2026-11-19 20:00:00",
  sender: { uin, uid, name },
  content: { text },
});
const parse = (rows) =>
  C.parse(JSON.stringify({ chatInfo: { name: "测试团" }, messages: rows }));

test("QQ identity survives nickname changes and UID-only messages", () => {
  const p = parse([
    row(0, undefined, "u_1", "旧昵称", "一"),
    row(1, "10001", "u_1", "新昵称", "二"),
  ]);
  assert.equal(p.people.length, 1);
  assert.equal(p.messages[0].personId, "qq:10001");
  p.people[0].role = "角色甲";
  assert.equal(C.role(p, p.messages[1]), "角色甲");
});
test("identical names never merge different QQ accounts or unidentified senders", () => {
  const p = parse([
    row(0, "10001", "u_1", "同名", "一"),
    row(1, "10002", "u_2", "同名", "二"),
    row(2, "", "", "同名", "三"),
    row(3, "", "", "同名", "四"),
  ]);
  assert.equal(p.people.length, 4);
});
test("ambiguous UID mappings do not attach UID-only messages to either QQ", () => {
  const p = parse([
    row(0, "10001", "u_1", "甲", "一"),
    row(1, "10002", "u_1", "乙", "二"),
    row(2, undefined, "u_1", "丙", "三"),
  ]);
  assert.equal(p.people.length, 3);
  assert.equal(p.messages[2].personId, "uid:u_1");
});
test("round grouping cannot bypass manual review", () => {
  const p = parse([
    row(0, "10001", "u_1", "甲", "一"),
    row(1, "10002", "u_2", "乙", "二"),
  ]);
  C.assign(p, [0, 1], "第1回合");
  assert.deepEqual(p.state.decisions, ["pending", "pending"]);
  assert.equal(p.state.current, 0);
  C.decide(p, 0, "keep");
  assert.equal(p.state.current, 1);
  assert.deepEqual(p.state.decisions, ["keep", "pending"]);
  assert.doesNotMatch(C.output(p), /【乙】/);
});
test("edited text and exclusion never modify original source", () => {
  const p = parse([
    row(0, "10001", "u_1", "甲", "原文"),
    row(1, "10001", "u_1", "甲", "删掉这条"),
  ]);
  const original = C.clone(p.original);
  C.decide(p, 0, "keep", "整理后正文");
  C.decide(p, 1, "exclude");
  assert.deepEqual(p.original, original);
  assert.match(C.output(p), /整理后正文/);
  assert.doesNotMatch(C.output(p), /删掉这条/);
});
test("an explicitly empty round does not inherit the previous round", () => {
  const p = parse([
    row(0, "10001", "u_1", "甲", "一"),
    row(1, "10001", "u_1", "甲", "二"),
  ]);
  C.assign(p, [0], "第1回合");
  C.decide(p, 0, "keep");
  C.assign(p, [1], "");
  C.decide(p, 1, "keep");
  assert.equal(p.state.rounds[1], "");
});
test("portable projects round-trip messages, raw extensions, roles, progress and draft", () => {
  const r = row(0, "10001", "u_1", "甲", "正文");
  r.content.resources = [
    { type: "image", filename: "地图.png", localPath: "resources/map.png" },
  ];
  r.extra = { custom: ["not discarded"] };
  const p = parse([r]);
  C.decide(p, 0, "keep", "改后的正文");
  C.assign(p, [0], "调查阶段");
  p.people[0].role = "调查员";
  p.state.draft = { index: 0, text: "还没确认的草稿" };
  const restored = C.parse(C.packed(p), "工程.qcelog");
  assert.deepEqual(restored, C.clone(p));
  assert.deepEqual(restored.messages[0].original.extra, r.extra);
});
test("malformed saved review states fail instead of silently losing progress", () => {
  const p = parse([row(0, "10001", "u_1", "甲", "正文")]);
  p.state.decisions = [];
  assert.throws(() => C.parse(JSON.stringify(p), "坏工程.qcelog"), /审阅进度/);
});
test("JSONL preserves source order, repeated IDs, multiline text and attachments", () => {
  const rows = [
    row("same", "10001", "u_1", "甲", "第一行\n第二行"),
    row("same", "10001", "u_1", "甲", "后来"),
  ];
  rows[0].content.resources = [{ type: "image", filename: "图.png" }];
  const p = C.parse(rows.map(JSON.stringify).join("\n"), "chunk.jsonl");
  assert.equal(p.messages.length, 2);
  assert.match(p.messages[0].text, /第一行\n第二行/);
  assert.match(p.messages[0].text, /图片：图.png/);
});
test("QQ/TIM text headers preserve multiline messages and both header orders", () => {
  const p = C.parse(
    "2026-11-19 20:00:00 甲(10001)\n第一行\n第二行\n乙(10002) 2026/11/19 20:01:00\n第三行",
    "聊天.txt",
  );
  assert.equal(p.messages.length, 2);
  assert.equal(p.people[1].qq, "10002");
  assert.match(p.messages[0].text, /第一行\n第二行/);
});
test("unrecognized text prefixes remain reviewable instead of disappearing", () => {
  const p = C.parse(
    "额外的前言\n2026-11-19 20:00:00 甲(10001)\n正文",
    "聊天.txt",
  );
  assert.equal(p.messages.length, 2);
  assert.match(p.messages[0].text, /额外的前言/);
  assert.equal(p.state.decisions[0], "pending");
});
test("unsupported text and malformed JSON are rejected", () => {
  assert.throws(() => C.parse("没有结构的文字", "聊天.txt"), /暂未识别/);
  assert.throws(() => C.parse('{"messages":['), /有效的 JSON/);
  assert.throws(() => C.parse('{"chunks":[]}'), /没有找到消息列表/);
});
test("HTML export escapes content, speaker names and titles", () => {
  const p = parse([
    row(
      0,
      "10001",
      "u_1",
      "<script>bad()</script>",
      "<img src=x onerror=bad()>",
    ),
  ]);
  p.title = "<script>title()</script>";
  C.decide(p, 0, "keep");
  const html = C.output(p, "html");
  assert.doesNotMatch(html, /<script>|<img src=x/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
});
test("grouped navigation still references original chronological positions", () => {
  const p = parse([
    row(0, "10001", "u_1", "甲", "开场"),
    row(1, "10002", "u_2", "乙", "回答"),
    row(2, "10001", "u_1", "甲", "继续"),
  ]);
  for (let i = 0; i < 3; i++) {
    C.decide(p, i, "keep");
    C.assign(p, [i], "第1回合");
  }
  assert.deepEqual(C.groups(p)[0].rounds[0].ids, [0, 2]);
  assert.ok(C.output(p).indexOf("回答") < C.output(p).indexOf("继续"));
  p.state.scope = { type: "round", personId: p.people[0].id, round: "第1回合" };
  C.decide(p, 0, "keep");
  assert.equal(p.state.current, 2);
});

test("active chapter applies to each reviewed action and can be switched off", () => {
  const p = parse(
    Array.from({ length: 4 }, (_, i) =>
      row(i, "10001", "u_1", "甲", "正文" + i),
    ),
  );
  C.startSection(p, "第2章");
  p.state.useSection = true;
  C.decide(p, 0, "keep");
  C.decide(p, 1, "exclude");
  C.decide(p, 2, "keep", "修改正文");
  assert.deepEqual(
    { ...p.state.rounds },
    { 0: "第2章", 1: "第2章", 2: "第2章" },
  );
  p.state.useSection = false;
  C.decide(p, 3, "keep");
  assert.equal(p.state.rounds[3], undefined);
  assert.equal(p.state.edits[2], "修改正文");
  assert.deepEqual(p.state.sections, ["第2章"]);
});
test("blank active chapter rejects review atomically", () => {
  const p = parse([row(0, "10001", "u_1", "甲", "正文")]);
  p.state.useSection = true;
  const before = C.clone(p);
  assert.throws(() => C.decide(p, 0, "keep", "修改"), /填写当前/);
  assert.deepEqual(C.clone(p), before);
});
test("merging chronologically interleaves windows without losing review overlays or draft", () => {
  const p = parse([
    row(0, "10001", "u_1", "甲", "旧1"),
    { ...row(1, "10002", "u_2", "乙", "旧2"), time: "2026-11-19 20:02:00" },
  ]);
  C.decide(p, 0, "keep", "旧1修改");
  C.assign(p, [0], "第一章");
  p.people[0].role = "调查员";
  p.state.current = 1;
  p.state.draft = { index: 1, text: "未确认草稿" };
  p.state.returnPoint = { current: 0, scope: { type: "all" } };
  const extra = parse([
    { ...row(0, "10001", "u_1", "新昵称", "新1"), time: "2026-11-19 20:01:00" },
  ]);
  const before = C.clone(p),
    result = C.merge(p, extra);
  assert.deepEqual(C.clone(p), before);
  assert.deepEqual(
    result.messages.map((m) => m.text),
    ["旧1", "新1", "旧2"],
  );
  assert.deepEqual(result.state.decisions, ["keep", "pending", "pending"]);
  assert.equal(result.state.current, 2);
  assert.deepEqual(result.state.draft, { index: 2, text: "未确认草稿" });
  assert.equal(result.state.returnPoint.current, 0);
  assert.equal(C.body(result, 0), "旧1修改");
  assert.equal(result.state.rounds[0], "第一章");
  assert.equal(result.people.length, 2);
  assert.equal(C.role(result, result.messages[1]), "调查员");
  assert.deepEqual(result.original, p.original);
  assert.deepEqual(result.windows[1].original, extra.original);
  assert.deepEqual(C.parse(C.packed(result)), C.clone(result));
});
test("merging bridges a UID-only identity across windows and preserves role navigation", () => {
  const p = parse([row(0, undefined, "u_1", "甲", "旧")]);
  p.people[0].role = "调查员";
  p.state.scope = { type: "person", personId: "uid:u_1" };
  p.state.returnPoint = {
    current: 0,
    scope: { type: "person", personId: "uid:u_1" },
  };
  const result = C.merge(
    p,
    parse([
      row(0, "10001", "u_1", "改名", "新"),
      row(1, "10002", "u_2", "甲", "同名"),
    ]),
  );
  assert.equal(result.people.length, 2);
  assert.equal(result.state.scope.personId, "qq:10001");
  assert.equal(result.state.returnPoint.scope.personId, "qq:10001");
  assert.equal(C.role(result, result.messages[1]), "调查员");
});
test("window inclusion filters exports and can be reversed without data loss", () => {
  const p = C.merge(
    parse([row(0, "10001", "u_1", "甲", "第一个窗口")]),
    parse([row(0, "10001", "u_1", "甲", "第二个窗口")]),
  );
  C.decide(p, 0, "keep");
  C.decide(p, 1, "keep");
  p.windows[1].enabled = false;
  assert.deepEqual(C.indices(p, { type: "draft" }), [0]);
  assert.doesNotMatch(C.output(p), /第二个窗口/);
  assert.deepEqual(
    C.indices(p, { type: "window", windowId: p.windows[1].id }),
    [1],
  );
  p.windows[1].enabled = true;
  assert.match(C.output(p), /第二个窗口/);
  assert.deepEqual(p.state.decisions, ["keep", "keep"]);
});
test("legacy projects migrate windows and reject malformed source metadata", () => {
  const p = parse([row(0, "10001", "u_1", "甲", "正文")]);
  delete p.windows;
  delete p.messages[0].windowId;
  delete p.state.sections;
  delete p.state.useSection;
  const migrated = C.validateProject(p);
  assert.equal(migrated.windows.length, 1);
  assert.equal(migrated.state.useSection, false);
  for (const windows of [
    {},
    [],
    [null],
    [{ id: "", name: "x", enabled: true }],
  ])
    assert.throws(() => C.validateProject({ ...migrated, windows }), /窗口/);
});

test("a draft cannot silently apply to a different current message", () => {
  const p = parse([
    row(0, "10001", "u_1", "甲", "一"),
    row(1, "10001", "u_1", "甲", "二"),
  ]);
  p.state.draft = { index: 1, text: "未确认草稿" };
  assert.throws(() => C.validateProject(p), /草稿/);
});

test("retained Log text uses a bracketed role and an actual newline", () => {
  const p = parse([row(0, "10001", "u_1", "KP", "第一行\n第二行")]);
  C.decide(p, 0, "keep");
  p.state.rounds[0] = "第一回合";
  assert.match(C.output(p, "md"), /\*\*第一回合\*\*\n\n/);
  assert.match(C.output(p), /【KP】\n第一行\n第二行/);
  assert.doesNotMatch(C.output(p), /\/\//);
  assert.match(
    C.output(p, "html"),
    /<header>【KP】<\/header><p>第一行\n第二行<\/p>/,
  );
});
test("editing the manuscript preserves source text, review decisions and cursor", () => {
  const p = parse([
    row(0, "10001", "u_1", "KP", "原文"),
    row(1, "10002", "u_2", "乙", "未确认"),
  ]);
  C.decide(p, 0, "keep");
  const before = C.clone(p);
  C.editKept(p, 0, "成稿修订");
  assert.deepEqual(p.original, before.original);
  assert.deepEqual(p.state.decisions, before.state.decisions);
  assert.equal(p.state.current, before.state.current);
  assert.match(C.output(p), /【KP】\n成稿修订/);
  assert.throws(() => C.editKept(p, 1, "不应确认"), /已保留/);
  assert.throws(() => C.editKept(p, 0, ""), /不能为空/);
});

test('朗读女 changes role tags without replacing brackets in the actual sentences', () => {
  const p=parse([row(0,'10001','u_1','KP','读到【线索】，再看[提示]。')]);C.decide(p,0,'keep');
  const before=C.packed(p);assert.match(C.output(p,'txt','langdu'),/\[KP\]\n读到【线索】，再看\[提示\]。/);
  assert.equal(C.packed(p),before);assert.match(C.output(p),/【KP】\n/);
});
test('豹骰 preserves accounts, edited multiline text and only retained messages', () => {
  const p=parse([row(0,'10001','u_1','KP','原文'),row(1,'10002','u_2','玩家(侦探)','原文二'),row(2,'10003','u_3','不保留','排除正文')]);
  C.decide(p,0,'keep','修订\n续行');C.decide(p,1,'keep');C.decide(p,2,'exclude');C.assign(p,[0,1],'第一回合');
  const text=C.output(p,'txt','sealdice');
  assert.match(text,/2026\/11\/19 20:00:00<KP\(10001\)>:修订\n续行/);
  assert.match(text,/<玩家\(侦探\)\(10002\)>:原文二/);
  assert.doesNotMatch(text,/排除正文|【KP】|第一回合/);
});
test('豹骰 keeps UID-only speakers distinct and does not invent an unknown date', () => {
  const p=parse([row(0,'','u_one','同名','甲'),row(1,'','u_two','同名','乙')]);
  for(const m of p.messages){m.time='';m.timestamp=0;C.decide(p,m.id,'keep');}
  const text=C.output(p,'txt','sealdice');assert.match(text,/<同名\(uid:u_one\)>:甲/);assert.match(text,/<同名\(uid:u_two\)>:乙/);assert.doesNotMatch(text,/1970|2026/);
  assert.throws(()=>C.output(p,'html','sealdice'),/TXT/);
});

test('豹骰 native JSON preserves role and account identity without parsing message-like header text', () => {
  const p=parse([row(0,'10001','u_1','KP','休息 20:00:00\n<引用>: 保留原样'),row(1,'10002','u_2','同名','第二句')]);
  for(let i=0;i<2;i++)C.decide(p,i,'keep');
  const data=JSON.parse(C.output(p,'json','sealdice'));
  assert.equal(data.version,1);assert.deepEqual(data.items.map(item=>item.IMUserId),['QQ:10001','QQ:10002']);
  assert.equal(data.items[0].message,'休息 20:00:00\n<引用>: 保留原样');assert.equal(data.items[0].isDice,false);assert.ok(data.items[0].time>0);
});
