# ADR 0002：多节点技术栈与演进边界

**状态：** Accepted  
**日期：** 2026-09-10

## 决策

1. V0.1 保持 Electron + React + TypeScript 客户端，以及 Node.js + TypeScript Local Daemon。
2. Control Plane 首选 TypeScript + Fastify + PostgreSQL。
3. Local Node 使用 SQLite；服务器端不使用 SQLite 作为多节点协调数据库。
4. 远程 Node Agent 独立部署后，Go 是优先演进候选，以获得单 binary、跨平台交付、资源占用和并发治理优势。
5. Rust/原生组件只承担强沙箱、OS 隔离和性能敏感模块，不作为平台主语言。
6. 节点远程协议必须 schema-first，并生成 TypeScript/Go 类型；不共享 Node.js 内部对象。
7. 本地通信使用 HTTP/IPC 与 SSE/WebSocket；远程节点优先使用 HTTPS + Connect/gRPC 或等价双向认证协议。
8. Workflow V0.1 使用持久化状态机；只有实际出现复杂多节点长流程需求时才引入 Temporal。
9. Artifact 的长期共享采用 Git 与 S3-compatible object storage；Git 不承担消息总线职责。

## 结论

多节点需求要求调整边界，而不是立即更换技术栈。先用 TypeScript 验证协议与调度语义，再依据可测量瓶颈迁移 Node Agent，可降低早期复杂度和重复实现风险。
