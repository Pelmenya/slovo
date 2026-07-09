
import {Type} from 'class-transformer'
import {IsOptional,IsString} from 'class-validator'




export class UpdateAgentSessionDto {
  @IsOptional()
@IsString()
userId?: string;
@IsOptional()
@IsString()
title?: string;
}
