
import {HealthCheckStatus} from '@prisma/client'
import {Type} from 'class-transformer'
import {IsIn,IsOptional,IsString} from 'class-validator'
import {ApiProperty} from '@nestjs/swagger'




export class UpdateHealthCheckDto {
  @IsOptional()
@IsString()
service?: string;
@ApiProperty({
  enum: HealthCheckStatus,
})
@IsOptional()
@IsIn(["ok","degraded","down"])
status?: HealthCheckStatus;
}
