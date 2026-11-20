import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
};

/** Keys are random and flat (`<48 hex>.<ext>`), so they are unguessable and path-safe. */
const KEY_PATTERN = /^[a-f0-9]{48}\.(jpg|png|webp|mp4)$/;

const mimeTypeOf = (key: string) => {
  const extension = key.split('.').pop();
  return Object.entries(EXTENSIONS).find(([, e]) => e === extension)![0];
};

interface StorageDriver {
  write(key: string, data: Buffer, mimeType: string): Promise<void>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

/** Development: files under STORAGE_DIR on this machine. */
class LocalDiskDriver implements StorageDriver {
  constructor(private readonly root: string) {}

  async write(key: string, data: Buffer) {
    await mkdir(this.root, { recursive: true });
    await writeFile(join(this.root, key), data);
  }

  read(key: string) {
    return readFile(join(this.root, key));
  }

  delete(key: string) {
    return rm(join(this.root, key), { force: true });
  }
}

/**
 * Production: any S3-compatible bucket (Supabase Storage, Cloudflare R2, AWS S3).
 * Hosts like Render wipe their disk on every deploy, so media must live here.
 */
class S3Driver implements StorageDriver {
  private readonly client: S3Client;

  constructor(private readonly bucket: string, config: ConfigService) {
    // Dashboard pastes often carry stray spaces or quotes, which break request signing.
    const setting = (key: string) =>
      config.getOrThrow<string>(key).trim().replace(/^["']|["']$/g, '');
    this.client = new S3Client({
      endpoint: setting('S3_ENDPOINT'),
      region: config.get<string>('S3_REGION')?.trim() || 'auto',
      credentials: {
        accessKeyId: setting('S3_ACCESS_KEY_ID'),
        secretAccessKey: setting('S3_SECRET_ACCESS_KEY'),
      },
      // Supabase and most non-AWS providers expect bucket-in-path URLs.
      forcePathStyle: true,
    });
  }

  async write(key: string, data: Buffer, mimeType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: mimeType,
      }),
    );
  }

  async read(key: string) {
    const object = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return Buffer.from(await object.Body!.transformToByteArray());
  }

  async delete(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}

/**
 * Stores generated media. STORAGE_DRIVER=s3 uses an S3-compatible bucket (production);
 * anything else writes to local disk (development). Callers only deal with keys, and
 * files are always served through GET /media/:key, so the bucket can stay private.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: StorageDriver;

  constructor(config: ConfigService) {
    const bucket = config.get<string>('S3_BUCKET');
    if (config.get('STORAGE_DRIVER') === 's3' && bucket) {
      this.driver = new S3Driver(bucket, config);
      this.logger.log(`Media storage: S3 bucket "${bucket}"`);
    } else {
      this.driver = new LocalDiskDriver(
        resolve(config.get<string>('STORAGE_DIR') ?? 'storage'),
      );
    }
  }

  async put(data: Buffer, mimeType: string): Promise<string> {
    const extension = EXTENSIONS[mimeType];
    if (!extension) throw new Error(`Unsupported media type ${mimeType}`);
    const key = `${randomBytes(24).toString('hex')}.${extension}`;
    await this.driver.write(key, data, mimeType);
    return key;
  }

  async get(key: string): Promise<{ data: Buffer; mimeType: string }> {
    if (!KEY_PATTERN.test(key)) throw new NotFoundException();
    try {
      return { data: await this.driver.read(key), mimeType: mimeTypeOf(key) };
    } catch {
      throw new NotFoundException();
    }
  }

  async remove(key: string) {
    if (!KEY_PATTERN.test(key)) return;
    try {
      await this.driver.delete(key);
    } catch (error) {
      // A leftover file is harmless; never fail the user's delete because of it.
      this.logger.warn(`Could not delete ${key}: ${(error as Error).message}`);
    }
  }

  /** Path the app requests the file from (prefixed with its API base URL). */
  publicPath(key: string) {
    return `/media/${key}`;
  }
}
