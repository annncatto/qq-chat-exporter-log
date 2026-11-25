/* QCE log editing model. Original messages remain immutable; review is an overlay. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LogEditorCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const KIND = "qce-trpg-project";
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const dict = () => Object.create(null);
  const string = (value) =>
    typeof value === "string"
      ? value
      : typeof value === "number"
        ? String(value)
        : "";
  const validQQ = (value) =>
    /^[1-9]\d{3,11}$/.test(string(value)) ? string(value) : "";
  const own = (object, key) =>
    Object.prototype.hasOwnProperty.call(object, key);
  const titleOf = (name) =>
    name.replace(/\.(jsonl?|txt|qcelog)$/i, "") || "跑团记录";
  function uid() {
    return (
      "log-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 12)
    );
  }
  function plainContent(message) {
    const content = message.content;
    if (typeof content === "string") return content;
    if (!content || typeof content !== "object") return "";
    const elements = Array.isArray(content.elements)
      ? content.elements.filter((e) => e && typeof e === "object")
      : [];
    let text =
      typeof content.text === "string"
        ? content.text
        : elements
            .filter((e) => e.type === "text")
            .map((e) => string(e.data?.text || e.data?.content))
            .join("");
    const media = (
      Array.isArray(content.resources) && content.resources.length
        ? content.resources
        : elements
            .filter((e) =>
              [
                "image",
                "audio",
                "video",
                "file",
                "face",
                "market_face",
                "forward",
              ].includes(e.type),
            )
            .map((e) => ({ ...e.data, type: e.type }))
    ).filter((item) => item && typeof item === "object");
    const labels = {
      image: "图片",
      audio: "语音",
      video: "视频",
      file: "文件",
      face: "表情",
      market_face: "表情",
      forward: "合并转发",
    };
    const annotations = [
      ...new Set(
        media.map(
          (item) =>
            "[" +
            (labels[item.type] || "附件") +
            (item.filename ? "：" + item.filename : "") +
            "]",
        ),
      ),
    ].filter((label) => !text.includes(label));
    if (annotations.length) text += (text ? "\n" : "") + annotations.join("\n");
    return text || (message.system ? "[系统消息]" : "[非文本消息]");
  }
  function makeProject(rows, title, original, sourceFormat) {
    if (!rows.length) throw new Error("文件中没有消息。");
    if (rows.length > 200000)
      throw new Error("单次最多整理 20 万条消息，请按日期分段导出。");
    const uidQQ = new Map();
    for (const message of rows) {
      const sender = message?.sender;
      if (!sender || typeof sender !== "object")
        throw new Error("消息缺少发送者，文件未导入。");
      const qq = validQQ(sender.uin);
      if (sender.uid && qq) {
        const key = string(sender.uid);
        uidQQ.set(key, uidQQ.has(key) && uidQQ.get(key) !== qq ? null : qq);
      }
    }
    const people = new Map();
    const messages = rows.map((message, index) => {
      const sender = message.sender;
      const senderUid = string(sender.uid);
      const qq = validQQ(sender.uin) || uidQQ.get(senderUid) || "";
      const personId = qq
        ? "qq:" + qq
        : senderUid
          ? "uid:" + senderUid
          : "unresolved:" + index;
      const name =
        string(
          sender.name || sender.groupCard || sender.nickname || sender.remark,
        ) ||
        qq ||
        "未识别发言者";
      if (!people.has(personId))
        people.set(personId, {
          id: personId,
          qq,
          uid: senderUid,
          name,
          role: name,
        });
      return {
        id: index,
        sourceId: string(message.id || message.msgId),
        personId,
        time: string(message.time),
        timestamp: Number(message.timestamp) || 0,
        text: plainContent(message),
        original: clone(message),
      };
    });
    const windowId = uid();
    for (const message of messages) message.windowId = windowId;
    return {
      kind: KIND,
      version: 1,
      id: uid(),
      title,
      sourceFormat,
      original,
      windows: [
        {
          id: windowId,
          name: title,
          enabled: true,
          format: sourceFormat,
          selfUin: string(original?.chatInfo?.selfUin),
          selfUid: string(original?.chatInfo?.selfUid),
        },
      ],
      messages,
      people: [...people.values()],
      state: {
        decisions: Array(rows.length).fill("pending"),
        edits: dict(),
        rounds: dict(),
        sections: [],
        useSection: false,
        defaultRound: "",
        current: 0,
        scope: { type: "all" },
        returnPoint: null,
        draft: null,
      },
    };
  }
  function parseText(text, name) {
    const rows = [];
    let current = null;
    const prefix = [];
    const stamp =
      "(\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}\\s+\\d{1,2}:\\d{2}(?::\\d{2})?)";
    const first = new RegExp(
      "^" + stamp + "\\s+(.+?)[(（<]([1-9]\\d{3,11})[)）>]\\s*$",
    );
    const last = new RegExp(
      "^(.+?)[(（<]([1-9]\\d{3,11})[)）>]\\s+" + stamp + "\\s*$",
    );
    for (const line of text.split(/\r?\n/)) {
      const a = line.match(first),
        b = a ? null : line.match(last);
      if (a || b) {
        current = {
          id: String(rows.length),
          time: a ? a[1] : b[3],
          sender: { uin: a ? a[3] : b[2], name: (a ? a[2] : b[1]).trim() },
          content: { text: "" },
        };
        rows.push(current);
      } else if (current)
        current.content.text += (current.content.text ? "\n" : "") + line;
      else prefix.push(line);
    }
    if (!rows.length)
      throw new Error(
        "暂未识别这种文本格式。请使用 QCE JSON，或带日期、昵称和 QQ 号的聊天记录。",
      );
    if (prefix.some((line) => line.trim()))
      rows.unshift({
        id: "preamble",
        time: "",
        sender: { name: "记录前言" },
        content: { text: prefix.join("\n") },
      });
    const project = makeProject(rows, titleOf(name), text, "qq-tim-txt");
    project.windows[0].filename = name;
    return project;
  }
  function parse(text, name = "聊天记录.json") {
    text = text.replace(/^\uFEFF/, "");
    let data;
    if (/\.(txt)$/i.test(name)) return parseText(text, name);
    try {
      data = JSON.parse(text);
    } catch {
      try {
        data = text
          .split(/\r?\n/)
          .filter((line) => line.trim())
          .map((line) => JSON.parse(line));
      } catch {
        throw new Error("文件不是有效的 JSON / JSONL，原工程未改变。");
      }
    }
    if (data?.kind === KIND) return validateProject(data);
    const rows = Array.isArray(data) ? data : data?.messages;
    if (!Array.isArray(rows))
      throw new Error(
        "没有找到消息列表。分块导出请打开消息 JSONL 文件，而不是 manifest.json。",
      );
    const project = makeProject(
      rows,
      string(data?.chatInfo?.name) || titleOf(name),
      data,
      Array.isArray(data) ? "jsonl" : "qce-json",
    );
    project.windows[0].filename = name;
    return project;
  }
  function validateProject(data) {
    if (
      data.version !== 1 ||
      !Array.isArray(data.messages) ||
      !Array.isArray(data.people) ||
      !data.state ||
      data.messages.length > 200000
    )
      throw new Error("不支持的工程格式。");
    if (
      typeof data.id !== "string" ||
      !data.id ||
      typeof data.title !== "string"
    )
      throw new Error("工程信息不完整。");
    data = clone(data);
    if (!data.windows) {
      const id = "window-" + data.id;
      data.windows = [
        {
          id,
          name: data.title,
          enabled: true,
          format: data.sourceFormat || "qce-json",
        },
      ];
      for (const message of data.messages) message.windowId = id;
    }
    if (!Array.isArray(data.windows) || !data.windows.length)
      throw new Error("原始窗口数据无效。");
    const windows = new Set();
    for (const window of data.windows) {
      if (
        !window ||
        typeof window.id !== "string" ||
        !window.id ||
        windows.has(window.id) ||
        typeof window.name !== "string" ||
        typeof window.enabled !== "boolean"
      )
        throw new Error("原始窗口数据无效。");
      windows.add(window.id);
    }
    const people = new Set();
    for (const person of data.people) {
      if (
        typeof person.id !== "string" ||
        people.has(person.id) ||
        typeof person.role !== "string" ||
        !person.role.trim()
      )
        throw new Error("工程中的角色数据无效。");
      people.add(person.id);
    }
    data.messages.forEach((message, i) => {
      if (
        message.id !== i ||
        !people.has(message.personId) ||
        !windows.has(message.windowId) ||
        typeof message.text !== "string" ||
        typeof message.time !== "string"
      )
        throw new Error("工程中的消息数据无效。");
    });
    const state = data.state,
      n = data.messages.length;
    const index = (key) => /^(0|[1-9]\d*)$/.test(key) && Number(key) < n;
    if (
      !Array.isArray(state.decisions) ||
      state.decisions.length !== n ||
      state.decisions.some((x) => !["pending", "keep", "exclude"].includes(x))
    )
      throw new Error("工程中的审阅进度无效。");
    if (
      state.current !== null &&
      (!Number.isInteger(state.current) ||
        state.current < 0 ||
        state.current >= n)
    )
      throw new Error("工程中的阅读位置无效。");
    for (const key of ["edits", "rounds"]) {
      if (
        !state[key] ||
        typeof state[key] !== "object" ||
        Array.isArray(state[key])
      )
        throw new Error("工程中的编辑数据无效。");
      for (const [i, value] of Object.entries(state[key]))
        if (
          !index(i) ||
          typeof value !== "string" ||
          (key === "rounds" && value.length > 60)
        )
          throw new Error("工程中的编辑数据无效。");
    }
    const validScope = (scope) =>
      scope &&
      (["all", "unassigned", "draft"].includes(scope.type) ||
        (scope.type === "person" && people.has(scope.personId)) ||
        (scope.type === "window" && windows.has(scope.windowId)) ||
        (scope.type === "section" && typeof scope.round === "string") ||
        (scope.type === "round" &&
          people.has(scope.personId) &&
          typeof scope.round === "string"));
    if (
      !validScope(state.scope) ||
      typeof state.defaultRound !== "string" ||
      state.defaultRound.length > 60
    )
      throw new Error("工程中的回合归类无效。");
    if (
      state.returnPoint &&
      (!Number.isInteger(state.returnPoint.current) ||
        state.returnPoint.current < 0 ||
        state.returnPoint.current >= n ||
        !validScope(state.returnPoint.scope))
    )
      throw new Error("工程中的跳转位置无效。");
    if (
      state.draft &&
      (!Number.isInteger(state.draft.index) ||
        state.draft.index < 0 ||
        state.draft.index >= n ||
        state.draft.index !== state.current ||
        typeof state.draft.text !== "string")
    )
      throw new Error("工程中的草稿无效。");
    if (!state.sections)
      state.sections = [
        ...new Set(Object.values(state.rounds).filter(Boolean)),
      ];
    if (typeof state.useSection !== "boolean")
      state.useSection = !!state.defaultRound;
    if (
      !Array.isArray(state.sections) ||
      state.sections.some(
        (s) => typeof s !== "string" || !s.trim() || s.length > 60,
      )
    )
      throw new Error("章节 / 回合名称无效。");
    return data;
  }
  function role(project, message) {
    return (
      project.people.find((person) => person.id === message.personId)?.role ||
      "未识别发言者"
    );
  }
  function body(project, index) {
    return own(project.state.edits, index)
      ? project.state.edits[index]
      : project.messages[index].text;
  }
  function indices(project, scope = project.state.scope) {
    const state = project.state;
    const enabled = new Set(
      project.windows.filter((w) => w.enabled).map((w) => w.id),
    );
    return project.messages
      .filter((message) =>
        scope.type === "window"
          ? message.windowId === scope.windowId
          : enabled.has(message.windowId) &&
            (scope.type === "all" ||
              (scope.type === "person" &&
                message.personId === scope.personId) ||
              (state.decisions[message.id] === "keep" &&
                (scope.type === "draft" ||
                  (scope.type === "unassigned"
                    ? !state.rounds[message.id]
                    : (scope.type === "section" ||
                        message.personId === scope.personId) &&
                      (state.rounds[message.id] || "") === scope.round)))),
      )
      .map((message) => message.id);
  }
  function nextPending(project, from) {
    const ids = indices(project),
      ordered = ids
        .filter((i) => i > from)
        .concat(ids.filter((i) => i <= from));
    const pending = ordered.find(
      (i) => project.state.decisions[i] === "pending",
    );
    if (pending !== undefined) return pending;
    if (project.state.scope.type !== "all")
      return (
        ids.find((i) => i > from) ??
        (ids.includes(from) ? from : (ordered[0] ?? null))
      );
    return ids.includes(from) ? from : (ordered[0] ?? null);
  }
  function decide(project, index, decision, text) {
    if (
      !Number.isInteger(index) ||
      !project.messages[index] ||
      !["keep", "exclude"].includes(decision)
    )
      throw new Error("无效的审阅操作。");
    if (text !== undefined && (typeof text !== "string" || !text.trim()))
      throw new Error("正文为空，请填写内容或选择排除。");
    if (project.state.useSection && !project.state.defaultRound.trim())
      throw new Error("请填写当前章节 / 回合。");
    const revisiting = project.state.decisions[index] !== "pending";
    if (text !== undefined) project.state.edits[index] = text;
    project.state.decisions[index] = decision;
    if (project.state.useSection && project.state.defaultRound)
      project.state.rounds[index] = project.state.defaultRound;
    project.state.draft = null;
    const following = revisiting ? indices(project).find((id) => id > index) : undefined;
    project.state.current = following ?? nextPending(project, index);
  }
  function assign(project, ids, round) {
    round = round.trim();
    if (round.length > 60) throw new Error("章节 / 回合名称最多 60 个字。");
    if (ids.some((i) => !Number.isInteger(i) || !project.messages[i]))
      throw new Error("选区已失效。");
    for (const i of ids) project.state.rounds[i] = round;
    project.state.defaultRound = round;
    if (round && !project.state.sections.includes(round))
      project.state.sections.push(round);
    if (!indices(project).includes(project.state.current))
      project.state.current = nextPending(project, project.state.current ?? -1);
  }
  function startSection(project, label) {
    label = label.trim();
    if (label.length > 60) throw new Error("章节 / 回合名称最多 60 个字。");
    project.state.defaultRound = label;
    if (label && !project.state.sections.includes(label))
      project.state.sections.push(label);
  }
  function timeValue(message) {
    if (message.timestamp > 0)
      return message.timestamp < 1e11
        ? message.timestamp * 1000
        : message.timestamp;
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(message.time)) {
      const n = Date.parse(message.time.replace(/\//g, "-").replace(" ", "T"));
      if (Number.isFinite(n)) return n;
    }
    return null;
  }
  function merge(project, incoming) {
    const result = validateProject(project),
      extra = validateProject(incoming);
    if (result.messages.length + extra.messages.length > 200000)
      throw new Error("一个工程最多整理 20 万条消息。");
    const windowRemap = new Map();
    for (const window of extra.windows) {
      const id = uid();
      windowRemap.set(window.id, id);
      result.windows.push({
        ...window,
        id,
        original: window.original ?? extra.original,
      });
    }
    const knownQQ = new Map();
    for (const person of result.people.concat(extra.people)) {
      if (person.uid && person.qq)
        knownQQ.set(
          person.uid,
          knownQQ.has(person.uid) && knownQQ.get(person.uid) !== person.qq
            ? null
            : person.qq,
        );
    }
    const people = new Map(),
      remapPeople = new Map();
    for (const [owner, list] of [
      [0, result.people],
      [1, extra.people],
    ])
      for (const person of list) {
        const qq = person.qq || knownQQ.get(person.uid);
        const id = qq
          ? "qq:" + qq
          : person.uid
            ? "uid:" + person.uid
            : "unresolved:" + owner + ":" + person.id;
        remapPeople.set(owner + ":" + person.id, id);
        if (!people.has(id)) people.set(id, { ...person, id, qq: qq || "" });
      }
    const rows = result.messages
      .map((message, index) => ({
        message: {
          ...message,
          personId: remapPeople.get("0:" + message.personId),
        },
        owner: 0,
        index,
      }))
      .concat(
        extra.messages.map((message, index) => ({
          message: {
            ...message,
            windowId: windowRemap.get(message.windowId),
            personId: remapPeople.get("1:" + message.personId),
          },
          owner: 1,
          index,
        })),
      );
    if (rows.every((row) => timeValue(row.message) !== null))
      rows.sort((a, b) => timeValue(a.message) - timeValue(b.message));
    const oldState = result.state,
      newState = {
        ...oldState,
        decisions: [],
        edits: dict(),
        rounds: dict(),
        sections: [...new Set(oldState.sections.concat(extra.state.sections))],
      };
    const positions = new Map();
    rows.forEach((row, id) => {
      const source = row.owner ? extra.state : oldState;
      positions.set(row.owner + ":" + row.index, id);
      newState.decisions.push(source.decisions[row.index]);
      if (own(source.edits, row.index))
        newState.edits[id] = source.edits[row.index];
      if (own(source.rounds, row.index))
        newState.rounds[id] = source.rounds[row.index];
      row.message.id = id;
    });
    newState.current = positions.get("0:" + oldState.current) ?? 0;
    if (oldState.returnPoint)
      newState.returnPoint = {
        ...oldState.returnPoint,
        current: positions.get("0:" + oldState.returnPoint.current),
      };
    if (oldState.draft)
      newState.draft = {
        ...oldState.draft,
        index: positions.get("0:" + oldState.draft.index),
      };
    result.messages = rows.map((row) => row.message);
    result.people = [...people.values()];
    result.state = newState;
    if (newState.scope.personId)
      newState.scope = {
        ...newState.scope,
        personId: remapPeople.get("0:" + newState.scope.personId),
      };
    if (newState.returnPoint?.scope.personId)
      newState.returnPoint.scope = {
        ...newState.returnPoint.scope,
        personId: remapPeople.get("0:" + newState.returnPoint.scope.personId),
      };
    if (!oldState.draft && !oldState.decisions.includes("pending")) {
      const pending = result.state.decisions.findIndex((d) => d === "pending");
      if (pending >= 0) result.state.current = pending;
    }
    return validateProject(result);
  }
  function groups(project) {
    const enabled = new Set(
      project.windows.filter((w) => w.enabled).map((w) => w.id),
    );
    const entries = new Map(
      project.people.map((person) => [
        person.id,
        { person, rounds: new Map() },
      ]),
    );
    for (const message of project.messages) {
      if (
        project.state.decisions[message.id] !== "keep" ||
        !enabled.has(message.windowId)
      )
        continue;
      const round = project.state.rounds[message.id] || "",
        entry = entries.get(message.personId);
      if (!entry.rounds.has(round)) entry.rounds.set(round, []);
      entry.rounds.get(round).push(message.id);
    }
    return [...entries.values()]
      .filter((entry) => entry.rounds.size)
      .map((entry) => ({
        person: entry.person,
        rounds: [...entry.rounds].map(([round, ids]) => ({ round, ids })),
      }));
  }
  const escapeHTML = (text) =>
    text.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  function output(project, format = "txt", template = "standard") {
    if (format === "json" && template !== "sealdice") throw new Error("JSON 使用豹骰模板。");
    if (!["standard", "langdu", "sealdice"].includes(template)) throw new Error("不支持的导出模板。");
    if (template !== "standard" && format !== "txt" && !(template === "sealdice" && format === "json")) throw new Error("此模板使用 TXT 格式。");
    const open = template === "langdu" ? "[" : "【", close = template === "langdu" ? "]" : "】";
    const kept = indices(project, { type: "draft" }).map(
      (i) => project.messages[i],
    );
    if (template === "sealdice") {
      const people = new Map(project.people.map(person => [person.id, person]));
      if (format === "json") return JSON.stringify({version: 1, name: project.title, items: kept.map((message,index) => {
        const person=people.get(message.personId), timestamp=timeValue(message);
        return {id:index+1,nickname:person.role,IMUserId:person.qq ? "QQ:"+person.qq : "UID:"+(person.uid || person.id),
          time:timestamp === null ? 0 : Math.floor(timestamp/1000), message:body(project,message.id),isDice:false,commandId:0};
      })},null,2);
      const pad = n => String(n).padStart(2, "0");
      return kept.map(message => {
        const person = people.get(message.personId);
        const account = person.qq || "uid:" + encodeURIComponent(person.uid || person.id).replace(/[()]/g, c => "%" + c.charCodeAt(0).toString(16));
        const name = person.role.replace(/[\r\n<>]/g, c => c === "<" ? "＜" : c === ">" ? "＞" : " ");
        const value = timeValue(message), date = value === null ? null : new Date(value);
        const time = date && Number.isFinite(date.getTime())
          ? `${date.getFullYear()}/${pad(date.getMonth()+1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
          : /^\d{2}:\d{2}:\d{2}$/.test(message.time) ? message.time : "";
        return `${time}<${name}(${account})>:${body(project,message.id)}\n`;
      }).join("\n");
    }
    let previous = null;
    if (format === "html") {
      const nav = groups(project)
        .map(
          (group) =>
            "<details open><summary>" +
            escapeHTML(group.person.role) +
            "</summary>" +
            group.rounds
              .map(
                (groupRound) =>
                  '<a href="#m' +
                  groupRound.ids[0] +
                  '">' +
                  escapeHTML(groupRound.round || "未归类") +
                  "</a>",
              )
              .join("") +
            "</details>",
        )
        .join("");
      const content = kept
        .map((message) => {
          const round = project.state.rounds[message.id] || "";
          const section =
            round !== previous && (round || previous)
              ? "<h2>" + escapeHTML(round || "未归类") + "</h2>"
              : "";
          previous = round;
          return (
            section +
            '<article id="m' +
            message.id +
            '"><header>【' +
            escapeHTML(role(project, message)) +
            "】</header><p>" +
            escapeHTML(body(project, message.id)) +
            "</p></article>"
          );
        })
        .join("");
      return (
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
        escapeHTML(project.title) +
        "</title><style>" +
        "body{font:16px/1.8 system-ui,sans-serif;max-width:1000px;margin:40px auto;padding:0 20px;color:#242a30}" +
        "main{display:grid;grid-template-columns:180px minmax(0,1fr);gap:30px}nav a{display:block;margin-left:18px;color:inherit}" +
        "section>h2{margin:1em 0 .4em;font-size:1em;font-weight:700;text-align:center;overflow-wrap:anywhere}" +
        "article{margin-bottom:24px;scroll-margin-top:20px}header{font-weight:600}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:5px 0}" +
        "@media(max-width:600px){main{display:block}nav{margin-bottom:30px}}</style><h1>" +
        escapeHTML(project.title) +
        "</h1><main><nav>" +
        nav +
        "</nav><section>" +
        content +
        "</section></main></html>"
      );
    }
    const escapeMD = (text) => text.replace(/[\\`*_{}[\]<>#|]/g, "\\$&");
    const lines = [
      format === "md" ? "# " + escapeMD(project.title) : project.title,
      "",
    ];
    for (const message of kept) {
      const round = project.state.rounds[message.id] || "";
      if (round !== previous && (round || previous))
        lines.push(
          (format === "md" ? "**" : open) +
            (format === "md"
              ? escapeMD(round || "未归类")
              : round || "未归类") +
            (format === "md" ? "**" : close),
          "",
        );
      previous = round;
      lines.push(
        format === "md"
          ? "**【" + escapeMD(role(project, message)) + "】**  "
          : open + role(project, message) + close,
        format === "md"
          ? escapeMD(body(project, message.id))
          : body(project, message.id),
        "",
      );
    }
    return lines.join("\n");
  }
  function editKept(project, index, text) {
    if (!project.messages[index] || project.state.decisions[index] !== "keep")
      throw new Error("只能编辑已保留的 Log 正文。");
    if (typeof text !== "string" || !text.trim())
      throw new Error("正文不能为空。");
    project.state.edits[index] = text;
  }
  function packed(project) {
    return JSON.stringify(validateProject(project));
  }
  return {
    KIND,
    parse,
    validateProject,
    role,
    body,
    indices,
    nextPending,
    decide,
    assign,
    startSection,
    merge,
    groups,
    output,
    packed,
    editKept,
    escapeHTML,
    clone,
  };
});
