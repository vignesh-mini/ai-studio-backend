import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

// Boots the real module graph (guards, pipes, controllers) with the database stubbed,
// so wiring and request validation are checked without a PostgreSQL instance.
describe('API (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $connect: vi.fn(), $disconnect: vi.fn() })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(() => app.close());

  it('serves the public health check', () =>
    request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200, { status: 'ok' }));

  it('requires a token for protected routes', async () => {
    await request(app.getHttpServer()).get('/api/v1/models').expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/chat/messages')
      .send({})
      .expect(401);
  });

  it('validates login input before touching the database', () =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email', password: '1' })
      .expect(400));

  it('reports social sign-in as not implemented yet', () =>
    request(app.getHttpServer()).post('/api/v1/auth/google').expect(501));
});
