-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('user', 'owner');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'user';
