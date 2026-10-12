# Backend Engineering Learning Roadmap

## 1. Tổng quan

### Mục tiêu chính

Phát triển năng lực từ backend developer có kinh nghiệm với Laravel/PHP thành **Senior Backend Engineer / Backend & Platform Engineer**, có khả năng:

* Thiết kế và triển khai backend system production-ready.
* Sử dụng TypeScript và Node.js làm stack backend chính bên cạnh Laravel.
* Thiết kế architecture phù hợp với quy mô, nghiệp vụ và yêu cầu vận hành.
* Hiểu sâu database, caching, messaging, concurrency và distributed systems.
* Xây dựng hệ thống có khả năng mở rộng, quan sát, kiểm thử và bảo trì.
* Tích hợp AI/LLM vào backend và hệ thống tự động hóa khi phù hợp.
* Sử dụng AI coding agents để tăng năng suất nhưng vẫn giữ khả năng tự thiết kế, review và chịu trách nhiệm về chất lượng code.

### Nguyên tắc

1. Ưu tiên chiều sâu thay vì học nhiều ngôn ngữ cùng lúc.
2. Học thông qua project thực tế, không chỉ đọc tài liệu hoặc làm tutorial.
3. Ưu tiên hiểu nguyên lý và trade-off trước khi áp dụng design pattern.
4. Không mặc định mọi hệ thống đều cần DDD, CQRS hoặc microservices.
5. Giữ Laravel/PHP như một thế mạnh hiện có; không viết lại hệ thống chỉ vì muốn đổi công nghệ.
6. TypeScript/Node.js là stack mở rộng chính; Python được bổ sung khi cần làm việc với AI.
7. Go và Rust chưa nằm trong phạm vi ưu tiên ban đầu.
8. Mọi kiến thức quan trọng phải được áp dụng, kiểm thử và giải thích lại được.

---

## 2. Background và định hướng phát triển

### Kinh nghiệm hiện có

* Backend development với PHP/Laravel.
* Phát triển các hệ thống ERP, POS, CRM và API integration.
* Làm việc với PostgreSQL, Redis, queue và Kafka.
* Có kinh nghiệm với Vue.js, React/Next.js và hệ sinh thái JavaScript.
* Đang tìm hiểu TypeScript, Node.js, AI agents và local AI.
* Sử dụng Claude Code, AGY CLI và các công cụ AI để hỗ trợ phát triển phần mềm.

### Định hướng

Phát triển theo hướng:

**Backend Engineer → Senior Backend Engineer → Backend / Platform Engineer**

Các năng lực trọng tâm:

1. TypeScript và Node.js.
2. Software architecture và domain modeling.
3. Database và data consistency.
4. Event-driven architecture và distributed systems.
5. Testing, security, performance và observability.
6. Infrastructure và deployment.
7. AI-enabled backend và automation.

---

## 3. Phạm vi công nghệ

### Ưu tiên chính

| Công nghệ     | Vai trò                                       |
| ------------- | --------------------------------------------- |
| TypeScript    | Ngôn ngữ chính cho backend mới                |
| Node.js       | Runtime và backend platform                   |
| NestJS        | Framework backend production                  |
| PostgreSQL    | Database quan hệ                              |
| Redis         | Caching, coordination và các use case phù hợp |
| Kafka         | Event streaming và asynchronous integration   |
| Docker        | Development và deployment                     |
| Vitest        | Unit và integration testing                   |
| Zod           | Runtime validation và schema inference        |
| OpenTelemetry | Observability và distributed tracing          |

Các công nghệ bổ sung tùy giai đoạn:

* Fastify hoặc Express để hiểu HTTP server và middleware.
* Prisma hoặc một giải pháp data access phù hợp để làm việc với database.
* GitHub Actions hoặc GitLab CI cho CI/CD.
* Prometheus và Grafana cho metrics và monitoring.
* Python cho AI integration, data processing và hệ sinh thái ML khi cần.
* AI SDK, MCP và vector database cho các bài toán AI phù hợp.

Không cần học tất cả cùng lúc. Mỗi công nghệ phải gắn với một bài toán cụ thể.

---

## 4. Roadmap tổng thể

Thời lượng dự kiến: 9–12 tháng.

Thời gian có thể điều chỉnh theo tiến độ và thời gian học thực tế. Không chuyển phase chỉ vì đã hết số tuần quy định.

### Phase 01 — Advanced TypeScript

Thời lượng: 4–6 tuần.

Mục tiêu:

* Hiểu sâu TypeScript type system.
* Thiết kế type an toàn cho domain, API và business logic.
* Hiểu ranh giới giữa compile-time types và runtime validation.
* Viết code dễ đọc, dễ kiểm thử và dễ refactor.

Nội dung:

1. Type inference, type narrowing và structural typing.
2. `type` và `interface`.
3. Union, intersection và discriminated unions.
4. Generics và generic constraints.
5. Utility types.
6. Conditional types, mapped types, `keyof`, `typeof`, `infer`.
7. Function types, overloads và async return types.
8. Module system, ESM, `tsconfig` và compiler options.
9. Runtime validation với Zod.
10. Error handling, API contracts và testing.

Project:

Xây dựng domain layer cho Order Management System, bao gồm Customer, Product, Order, OrderItem và Payment.

Tiêu chí hoàn thành:

* Không sử dụng `any` nếu không có lý do được giải thích rõ.
* Hiểu và giải thích được type inference.
* Biết sử dụng discriminated unions để mô hình hóa trạng thái.
* Phân biệt dữ liệu đã được kiểm tra với dữ liệu đầu vào chưa đáng tin cậy.
* Viết unit tests cho business logic.
* Có thể giải thích các quyết định thiết kế type.

### Phase 02 — Node.js Runtime và Internals

Thời lượng: 4–6 tuần.

Nội dung:

* Event loop, microtasks và timers.
* Promise, async/await và error propagation.
* libuv và I/O concurrency.
* CPU-bound versus I/O-bound workloads.
* Worker Threads và child processes.
* Streams, Buffer và backpressure.
* File system, signals, process lifecycle và IPC.
* HTTP, TCP, WebSocket và graceful shutdown.
* Memory usage, profiling và debugging.

Project:

Xây dựng một HTTP server nhỏ với routing, middleware, centralized error handling và structured logging.

Tiêu chí hoàn thành:

* Giải thích được cách Node.js xử lý I/O và tác vụ CPU-bound.
* Phân biệt asynchronous I/O với parallel CPU execution.
* Biết đọc memory profile và xử lý lỗi runtime.
* Hiểu backpressure và graceful shutdown.

### Phase 03 — Production Backend với NestJS

Thời lượng: 6–8 tuần.

Nội dung:

* NestJS modules, controllers và providers.
* Dependency Injection.
* DTO, validation và serialization.
* Authentication, authorization và RBAC.
* Database transactions.
* Repository và application services.
* API pagination, filtering và versioning.
* Unit tests, integration tests và API tests.
* Configuration, secrets và environment management.
* Security, rate limiting và request validation.

Project:

Phát triển Order Management API với PostgreSQL, Redis và bộ kiểm thử tự động.

Tiêu chí hoàn thành:

* Có cấu trúc module rõ ràng.
* Có authentication và authorization.
* Xử lý transaction và validation đúng.
* Có test cho các luồng nghiệp vụ quan trọng.
* Có logging, configuration và hướng dẫn chạy project.

### Phase 04 — Software Architecture

Thời lượng: 6–8 tuần.

Nội dung:

* Separation of concerns và dependency management.
* Layered Architecture.
* Clean Architecture.
* Hexagonal Architecture.
* Modular Monolith.
* Dependency Inversion Principle.
* SOLID và composition.
* Architecture Decision Records (ADR).
* Coupling, cohesion và testability.
* Refactoring và evolutionary architecture.

Project:

Refactor Order Management System thành Modular Monolith với các module có ranh giới rõ ràng.

Tiêu chí hoàn thành:

* Giải thích được lý do chọn architecture.
* Xác định được dependency boundaries.
* Tránh business logic phụ thuộc trực tiếp framework hoặc database.
* Biết khi nào abstraction hữu ích và khi nào chỉ làm tăng độ phức tạp.
* Ghi lại các quyết định kiến trúc quan trọng.

### Phase 05 — Domain-Driven Design

Thời lượng: 4–6 tuần.

Nội dung:

* Domain, subdomain và bounded context.
* Ubiquitous Language.
* Entity và Value Object.
* Aggregate và Aggregate Root.
* Domain Service và Application Service.
* Repository.
* Domain Event.
* Invariants và business rules.
* Context Mapping.
* DDD trong Modular Monolith.

Project:

Mô hình hóa các domain Order, Payment và Inventory theo nghiệp vụ thực tế.

Tiêu chí hoàn thành:

* Xác định được domain boundaries dựa trên nghiệp vụ.
* Business rules được đặt ở nơi phù hợp.
* Phân biệt domain logic với application orchestration.
* Tránh tạo aggregate quá lớn hoặc abstraction không cần thiết.

### Phase 06 — Event-Driven Architecture và Kafka

Thời lượng: 4–6 tuần.

Nội dung:

* Synchronous versus asynchronous communication.
* Event notification và event-carried state transfer.
* Producer, consumer, partition và consumer group.
* Ordering và delivery semantics.
* Retry, backoff và dead-letter queue.
* Idempotent consumers.
* Transactional Outbox.
* Schema evolution và event versioning.
* Eventual consistency.
* Observability và xử lý lỗi khi consumer chạy lại.

Project:

Mô phỏng luồng ERP → Kafka → CRM và Marketing, sử dụng các event như CustomerUpdated, OrderCompleted và InvoiceCreated.

Tiêu chí hoàn thành:

* Có chiến lược xử lý duplicate events.
* Hiểu giới hạn của exactly-once processing khi kết hợp Kafka với database ngoài.
* Có retry và dead-letter strategy.
* Có giải pháp xử lý tình huống database commit thành công nhưng consumer chưa commit offset.
* Tài liệu hóa event contracts.

### Phase 07 — Distributed Systems và System Design

Thời lượng: 4–6 tuần.

Nội dung:

* CAP theorem và các trade-off liên quan.
* Consistency models.
* Idempotency và deduplication.
* Distributed transactions và Saga.
* Timeouts, retries và circuit breakers.
* Rate limiting và backpressure.
* Caching strategies và cache invalidation.
* Service discovery và load balancing.
* Failure modes và resilience.
* Partitioning và scaling.
* Messaging guarantees.

Bài tập thiết kế:

* Notification System.
* Payment System.
* Order Processing System.
* ERP Integration Platform.
* Chat hoặc realtime system.
* AI Agent Backend.

Tiêu chí hoàn thành:

* Có thể phân tích yêu cầu chức năng và phi chức năng.
* Xác định bottleneck và failure modes.
* Giải thích trade-off về consistency, latency và availability.
* Thiết kế được API, data model, event flow và cơ chế recovery.

### Phase 08 — Database và Performance

Thời lượng: 4–6 tuần.

Nội dung:

* PostgreSQL indexes và query plans.
* Transactions và isolation levels.
* Locking và deadlocks.
* Connection pooling.
* N+1 queries.
* Redis caching và cache invalidation.
* Concurrency và throughput.
* Load testing.
* CPU và memory profiling.
* Queue-based workload management.

Project:

Đo hiệu năng Order Management API trước và sau khi tối ưu.

Tiêu chí hoàn thành:

* Có baseline performance.
* Xác định bottleneck bằng dữ liệu đo.
* Có benchmark trước và sau tối ưu.
* Không tối ưu chỉ dựa trên cảm tính.
* Hiểu trade-off giữa throughput, latency và tài nguyên.

### Phase 09 — Production Readiness

Thời lượng: 3–4 tuần.

Nội dung:

* Docker và container fundamentals.
* CI/CD.
* Environment và secret management.
* Structured logging.
* Metrics, tracing và OpenTelemetry.
* Health checks và readiness.
* Graceful shutdown.
* Security fundamentals.
* Backup, recovery và incident handling.
* Deployment và rollback.

Tiêu chí hoàn thành:

* Có pipeline kiểm tra và build.
* Có hướng dẫn deploy.
* Có logging, metrics và tracing phù hợp.
* Có quy trình xử lý lỗi và rollback.
* Không để secrets trong source code.

### Phase 10 — AI Backend và Integration

Thời lượng: 3–4 tuần, có thể điều chỉnh.

Nội dung:

* Tích hợp LLM API.
* Streaming responses.
* Tool calling.
* MCP.
* Embeddings và vector search.
* RAG fundamentals.
* Timeouts, retries và cost controls.
* Observability cho AI workflows.
* Authorization và giới hạn quyền thực thi tool.

Project:

Xây dựng AI assistant backend có khả năng truy xuất dữ liệu nghiệp vụ được cấp quyền và gọi các công cụ có kiểm soát.

Tiêu chí hoàn thành:

* Tách biệt AI orchestration với business logic.
* Kiểm soát quyền truy cập dữ liệu và tool execution.
* Có timeout, error handling và giới hạn chi phí.
* Không xem output từ LLM là dữ liệu đáng tin cậy mặc định.

---

## 5. Capstone Project

Project xuyên suốt: **Order Management & Event Integration Platform**.

### Kiến trúc mục tiêu

```text
Client / Admin UI
        |
        v
   NestJS API
        |
        v
 Modular Monolith
  |      |      |
Order  Payment Inventory
        |
        v
   PostgreSQL
        |
   Outbox / Worker
        |
        v
      Kafka
        |
   +----+----+
   |         |
  CRM     Marketing
```

Redis, observability và AI integration được bổ sung khi có yêu cầu phù hợp.

### Yêu cầu

* Có domain model rõ ràng.
* Có API contract và runtime validation.
* Có database migrations và transaction handling.
* Có unit tests, integration tests và end-to-end tests cho các luồng quan trọng.
* Có xử lý duplicate events, retry và dead-letter.
* Có logging và monitoring.
* Có Docker-based local environment.
* Có tài liệu architecture, ADR và deployment.
* Có benchmark và ghi nhận các giới hạn đã biết.

Không cần bắt đầu bằng microservices. Ưu tiên Modular Monolith, chỉ tách service khi có lý do kỹ thuật hoặc nghiệp vụ rõ ràng.

---

## 6. Phương pháp học

### Vòng lặp cho mỗi chủ đề

1. Đọc mục tiêu và kiến thức cần đạt.
2. Hiểu concept bằng ví dụ nhỏ.
3. Tự triển khai bài tập.
4. Viết test và xác minh hành vi.
5. Review code.
6. Refactor.
7. Giải thích lại bằng lời của mình.
8. Ghi nhận tiến độ và các điểm chưa hiểu.

### Phân bổ thời gian tham khảo

Nếu có khoảng 7–10 giờ mỗi tuần:

* 20%: đọc tài liệu và nắm concept.
* 50%: code project và bài tập.
* 20%: testing, debugging và refactoring.
* 10%: ghi chú, review và tổng kết.

Tập trung vào chất lượng hiểu biết, không chạy theo số lượng tutorial hoặc commit.

---

## 7. Sử dụng AI Coding Agents

Claude Code, AGY CLI và các AI agent là công cụ hỗ trợ học tập, không thay thế việc hiểu code.

### Agent được phép hỗ trợ

* Giải thích concept và đưa ví dụ.
* Đặt câu hỏi kiểm tra kiến thức.
* Review code và test.
* Phát hiện edge cases.
* Đề xuất refactor kèm lý do.
* Tạo bài tập tăng dần độ khó.
* Hỗ trợ đọc lỗi compiler và test failure.
* Kiểm tra tiến độ so với roadmap.

### Agent không nên làm mặc định

* Viết toàn bộ lời giải trước khi người học thử.
* Tự chuyển phase mà chưa đánh giá kiến thức.
* Thêm dependency hoặc design pattern không cần thiết.
* Tạo abstraction phức tạp chỉ để code trông chuyên nghiệp.
* Tự đánh dấu hoàn thành khi chưa có bằng chứng kiểm tra.

### Workflow đề xuất

```text
ROADMAP
   |
   v
Learning Objective
   |
   v
Concept + Exercise
   |
   v
Learner Implementation
   |
   v
Code Review
   |
   v
Tests + Verification
   |
   v
Reflection
   |
   v
PROGRESS.md
```

Mỗi bài nên có mục tiêu, bài tập, tiêu chí đánh giá và kết quả kiểm tra rõ ràng.

---

## 8. Definition of Done cho từng phase

Một phase chỉ được đánh dấu hoàn thành khi:

* [ ] Nắm được các concept cốt lõi.
* [ ] Tự triển khai được bài tập mà không phụ thuộc hoàn toàn vào AI.
* [ ] Có test cho các hành vi quan trọng.
* [ ] Xử lý được các edge cases chính.
* [ ] Giải thích được các quyết định thiết kế.
* [ ] Đã review và refactor code.
* [ ] Có README hoặc ghi chú kiến thức.
* [ ] Đã cập nhật PROGRESS.md.
* [ ] Có thể trả lời các câu hỏi đánh giá cuối phase.

Nếu còn lỗ hổng kiến thức quan trọng, tiếp tục luyện tập trước khi chuyển phase.

---

## 9. Tiến độ và quản lý kiến thức

Duy trì các tài liệu:

* `ROADMAP.md`: mục tiêu dài hạn và các phase.
* `PROGRESS.md`: trạng thái hiện tại, kết quả và điểm còn yếu.
* `LEARNING_NOTES.md`: kiến thức và bài học rút ra.
* `ADR/`: quyết định kiến trúc trong project.
* `README.md`: hướng dẫn chạy và kiểm thử project.

Không cần sao chép toàn bộ roadmap vào mỗi task. Agent chỉ cần đọc roadmap và trạng thái hiện tại, sau đó tập trung vào phase đang học.

---

## 10. Bắt đầu ngay — Phase 01

Thư mục:

`01-typescript`

Bài đầu tiên:

* Type system fundamentals.
* `type` versus `interface`.
* Union types.
* Discriminated unions.
* Type inference.
* Unit testing.

Bài thực hành mở đầu:

Xây dựng hàm `calculateOrderTotal(order)` cho Order Management System.

Yêu cầu:

* Có type cho Order và OrderItem.
* Không sử dụng `any`.
* Không mutate dữ liệu đầu vào.
* Xử lý đơn hàng không có item.
* Có test cho trường hợp thông thường, đơn rỗng và các giá trị biên.
* Giải thích được cách TypeScript suy luận kiểu trả về.

**Nguyên tắc cuối cùng:** Mục tiêu không phải biết thật nhiều công nghệ. Mục tiêu là có thể tự phân tích, thiết kế, triển khai, kiểm thử, vận hành và cải tiến một backend system trong môi trường production.
