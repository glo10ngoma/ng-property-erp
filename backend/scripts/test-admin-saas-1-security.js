const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function includesAll(source, needles, label) {
  for (const needle of needles) {
    assert(source.includes(needle), `${label}: missing "${needle}"`);
  }
}

function main() {
  const backendRoot = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(backendRoot, '..');

  const controller = read(backendRoot, 'src/saas/saas.controllers.ts');
  const service = read(backendRoot, 'src/saas/saas.service.ts');
  const dto = read(backendRoot, 'src/saas/settings.dto.ts');
  const permissions = read(backendRoot, 'src/saas/permissions.ts');
  const orgAccess = read(backendRoot, 'src/auth/organization-access.service.ts');
  const platformCreateUserSection = service.match(/async platformCreateUser[\s\S]*?async platformUpdateUser/);

  assert(platformCreateUserSection, 'platform service: platformCreateUser section not found');

  includesAll(
    controller,
    [
      "@UseGuards(PlatformRoleGuard)",
      "@UseGuards(SuperAdminOnlyGuard)",
      "@SuperAdminOnly('Seul le Super Administrateur peut modifier un utilisateur plateforme.')",
      'createOrganization(@Body() body: CreatePlatformOrganizationDto)',
      'updateOrganization(@Param(\'id\', ParseIntPipe) id: number, @Body() body: UpdatePlatformOrganizationDto)',
      'createUser(@Body() body: CreatePlatformUserDto)',
      'updateUser(@Param(\'id\', ParseIntPipe) id: number, @Body() body: UpdatePlatformUserDto)',
      'upsertMembership(@Body() body: CreatePlatformMembershipDto)',
      'updateMembership(@Param(\'id\', ParseIntPipe) id: number, @Body() body: UpdatePlatformMembershipDto)',
    ],
    'platform controller',
  );

  includesAll(
    dto,
    [
      'export class PlatformListQueryDto',
      'export class CreatePlatformOrganizationDto',
      'export class UpdatePlatformOrganizationDto',
      'export class CreatePlatformUserDto',
      'export class UpdatePlatformUserDto',
      'export class CreatePlatformMembershipDto',
      'export class UpdatePlatformMembershipDto',
      '@Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)',
      'PLATFORM_SCOPED_ROLE_CODES',
      'PLATFORM_ROLES',
      '@IsIn(PLATFORM_ORGANIZATION_STATUSES)',
      '@IsIn(PLATFORM_USER_STATUSES)',
    ],
    'platform dto',
  );

  assert(!dto.includes('password_hash!:'), 'platform dto must not expose password_hash');

  includesAll(
    service,
    [
      'this.ensureActorIsSuperAdmin();',
      "throw new ForbiddenException('PLATFORM_SUPER_ADMIN_REQUIRED')",
      "throw new BadRequestException('PLATFORM_ROLE_INVALID')",
      "throw new ConflictException('LAST_ACTIVE_SUPER_ADMIN')",
      "throw new ConflictException('PLATFORM_USER_SELF_LOCKOUT')",
      "throw new ConflictException('PLATFORM_MEMBERSHIP_ALREADY_EXISTS')",
      "throw new ConflictException('PLATFORM_ROLE_ORGANIZATION_MISMATCH')",
      "throw new ConflictException('ORGANIZATION_ACCESS_DENIED')",
      'private sanitizePlatformAuditPayload(payload: unknown): unknown',
      "clone[key] = '[REDACTED]'",
      'await this.ensureActivePlatformOrganization(organizationId);',
      'await this.ensureActivePlatformUser(userId);',
    ],
    'platform service',
  );

  assert(
    !platformCreateUserSection[0].includes("String(body.password ?? body.password_hash ?? 'demo')"),
    'platform user creation must not fallback to password_hash or demo password',
  );
  assert(
    !platformCreateUserSection[0].includes('COALESCE($8, 1)'),
    'platform user creation must not fallback silently to organization 1',
  );

  includesAll(
    permissions,
    [
      "'platform.organizations.read'",
      "'platform.organizations.manage'",
      "'platform.users.read'",
      "'platform.users.manage'",
      "'platform.memberships.read'",
      "'platform.memberships.manage'",
      "'platform.roles.read'",
      "'platform.audit.read'",
    ],
    'platform permissions',
  );

  includesAll(
    orgAccess,
    [
      'loadDeniedOrganizationsForUser',
      'Membership fallback used for user',
    ],
    'organization access fallback',
  );

  console.log('test-admin-saas-1-security: OK');
}

try {
  main();
} catch (error) {
  console.error('test-admin-saas-1-security: FAIL');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
