import { Global, Module } from '@nestjs/common';
import { SecretsManagerService } from './secrets-manager.service';

@Global()
@Module({
  providers: [SecretsManagerService],
  exports: [SecretsManagerService],
})
export class SecretsModule {}
