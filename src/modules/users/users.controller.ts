import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@/generated/prisma/enums';
import { Auth } from '@/shared/decorators/auth.decorator';
import { CurrentUser } from '@/shared/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/shared/interfaces/authenticated-user.interface';
import { CreateUserDto } from './dto/create-user.dto';
import { AdminChangePasswordDto } from './dto/admin-change-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UserIdParamDto } from './dto/user-id-param.dto';
import { UserListQueryDto } from './dto/user-list-query.dto';
import {
  MessageResponse,
  PaginatedUsersResponse,
  UserResponse,
} from './interfaces/user.interface';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Auth(UserRole.ADMIN)
  create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<UserResponse> {
    return this.usersService.create(dto, actor.id);
  }

  @Get()
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  findAll(@Query() query: UserListQueryDto): Promise<PaginatedUsersResponse> {
    return this.usersService.findAll(query);
  }

  @Get(':id')
  @Auth(UserRole.ADMIN, UserRole.MANAGER)
  findOne(@Param() params: UserIdParamDto): Promise<UserResponse> {
    return this.usersService.findOne(params);
  }

  @Patch(':id')
  @Auth(UserRole.ADMIN)
  update(
    @Param() params: UserIdParamDto,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<UserResponse> {
    return this.usersService.update(params, dto, actor.id);
  }

  @Patch(':id/status')
  @Auth(UserRole.ADMIN)
  updateStatus(
    @Param() params: UserIdParamDto,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<UserResponse> {
    return this.usersService.updateStatus(params, dto, actor.id);
  }

  @Patch(':id/password')
  @Auth(UserRole.ADMIN)
  changePassword(
    @Param() params: UserIdParamDto,
    @Body() dto: AdminChangePasswordDto,
  ): Promise<MessageResponse> {
    return this.usersService.changePassword(params, dto);
  }
}
