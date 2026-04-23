import { pgTable, serial, timestamp, unique, varchar, text, boolean, integer, index, pgPolicy, jsonb, foreignKey, bigint, uuid, pgSequence } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"


export const apiConfigsIdSeq = pgSequence("api_configs_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const apiConfigsIdSeq1 = pgSequence("api_configs_id_seq1", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const apiCredentialsIdSeq = pgSequence("api_credentials_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const apiCredentialsIdSeq1 = pgSequence("api_credentials_id_seq1", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const apiCredentialsNewIdSeq = pgSequence("api_credentials_new_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const apiCredentialsOldIdSeq = pgSequence("api_credentials_old_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const apiKeysIdSeq = pgSequence("api_keys_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const apiKeysIdSeq1 = pgSequence("api_keys_id_seq1", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const apiModelsBackupIdSeq = pgSequence("api_models_backup_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const apiModelsIdSeq = pgSequence("api_models_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const apiModelsIdSeq1 = pgSequence("api_models_id_seq1", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const apiModelsNewIdSeq = pgSequence("api_models_new_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const apiModelsOldIdSeq = pgSequence("api_models_old_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const apiModelsV2IdSeq = pgSequence("api_models_v2_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const apiParametersIdSeq = pgSequence("api_parameters_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const apiParametersIdSeq1 = pgSequence("api_parameters_id_seq1", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const apiParametersNewIdSeq = pgSequence("api_parameters_new_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const apiParametersOldIdSeq = pgSequence("api_parameters_old_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const apiProvidersIdSeq = pgSequence("api_providers_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const apiProvidersIdSeq1 = pgSequence("api_providers_id_seq1", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const apiServicesIdSeq = pgSequence("api_services_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const apiServicesIdSeq1 = pgSequence("api_services_id_seq1", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const apiServicesNewIdSeq = pgSequence("api_services_new_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const apiServicesOldIdSeq = pgSequence("api_services_old_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const creditRefundLogsIdSeq = pgSequence("credit_refund_logs_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "9223372036854775807", cache: "1", cycle: false })
export const creditRefundLogsIdSeq1 = pgSequence("credit_refund_logs_id_seq1", {  startWith: "1", increment: "1", minValue: "1", maxValue: "9223372036854775807", cache: "1", cycle: false })
export const generationRecordsIdSeq = pgSequence("generation_records_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const generationRecordsIdSeq1 = pgSequence("generation_records_id_seq1", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const modelCreditsConfigIdSeq = pgSequence("model_credits_config_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const modelCreditsConfigIdSeq1 = pgSequence("model_credits_config_id_seq1", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const promptFavoritesIdSeq = pgSequence("prompt_favorites_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const rechargePackagesIdSeq = pgSequence("recharge_packages_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const rechargePackagesIdSeq1 = pgSequence("recharge_packages_id_seq1", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const redeemKeysIdSeq = pgSequence("redeem_keys_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const redeemKeysIdSeq1 = pgSequence("redeem_keys_id_seq1", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const referenceImagesIdSeq = pgSequence("reference_images_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const referenceImagesIdSeq1 = pgSequence("reference_images_id_seq1", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const smsCodesIdSeq = pgSequence("sms_codes_id_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })
export const smsCodesIdSeq1 = pgSequence("sms_codes_id_seq1", {  startWith: "1", increment: "1", minValue: "1", maxValue: "2147483647", cache: "1", cycle: false })

export const healthCheck = pgTable("health_check", {
	id: serial().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const apiCredentialsOld = pgTable("api_credentials_old", {
	id: serial().primaryKey().notNull(),
	serviceType: varchar("service_type", { length: 50 }).notNull(),
	apiKey: text("api_key").notNull(),
	description: text(),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }),
}, (table) => [
	unique("api_credentials_service_type_key").on(table.serviceType),
]);

export const apiKeys = pgTable("api_keys", {
	id: integer().default(sql`nextval('api_keys_id_seq1'::regclass)`).primaryKey().notNull(),
	name: varchar({ length: 255 }).notNull(),
	type: varchar({ length: 100 }).notNull(),
	key: text().notNull(),
	status: varchar({ length: 20 }).default('active'),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const users = pgTable("users", {
	id: varchar({ length: 36 }).default(sql`gen_random_uuid()`).primaryKey().notNull(),
	phone: varchar({ length: 20 }).notNull(),
	password: varchar({ length: 255 }).notNull(),
	nickname: varchar({ length: 100 }),
	avatar: varchar({ length: 500 }),
	credits: integer().default(0).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("users_phone_idx").using("btree", table.phone.asc().nullsLast().op("text_ops")),
	unique("users_phone_unique").on(table.phone),
]);

export const apiModelsOld = pgTable("api_models_old", {
	id: serial().primaryKey().notNull(),
	serviceType: varchar("service_type", { length: 50 }).notNull(),
	modelId: varchar("model_id", { length: 100 }).notNull(),
	modelName: varchar("model_name", { length: 100 }).notNull(),
	description: text(),
	sortOrder: integer("sort_order").default(0),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	unique("api_models_service_type_model_id_key").on(table.serviceType, table.modelId),
]);

export const smsCodes = pgTable("sms_codes", {
	id: integer().default(sql`nextval('sms_codes_id_seq1'::regclass)`).primaryKey().notNull(),
	phone: varchar({ length: 20 }).notNull(),
	code: varchar({ length: 10 }).notNull(),
	type: varchar({ length: 20 }).notNull(),
	isUsed: boolean("is_used").default(false).notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("sms_codes_expires_at_idx").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")),
	index("sms_codes_phone_idx").using("btree", table.phone.asc().nullsLast().op("text_ops")),
]);

export const rechargePackages = pgTable("recharge_packages", {
	id: integer().default(sql`nextval('recharge_packages_id_seq1'::regclass)`).primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	price: integer().notNull(),
	credits: integer().notNull(),
	tag: varchar({ length: 50 }),
	savings: integer(),
	sortOrder: integer("sort_order").default(0).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_recharge_packages_is_active").using("btree", table.isActive.asc().nullsLast().op("bool_ops")),
	index("idx_recharge_packages_sort_order").using("btree", table.sortOrder.asc().nullsLast().op("int4_ops")),
	pgPolicy("recharge_packages_允许公开删除", { as: "permissive", for: "delete", to: ["public"], using: sql`true` }),
	pgPolicy("recharge_packages_允许公开更新", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("recharge_packages_允许公开写入", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("recharge_packages_允许公开读取", { as: "permissive", for: "select", to: ["public"] }),
]);

export const promptFavorites = pgTable("prompt_favorites", {
	id: serial().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	content: text().notNull(),
	sortOrder: integer("sort_order").default(0),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_prompt_favorites_sort_order").using("btree", table.sortOrder.asc().nullsLast().op("int4_ops")),
	index("idx_prompt_favorites_user_id").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	pgPolicy("Users can delete own favorites", { as: "permissive", for: "delete", to: ["public"], using: sql`(((auth.uid())::text = user_id) OR (user_id = ((current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text)))` }),
	pgPolicy("Users can update own favorites", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("Users can insert own favorites", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("Users can view own favorites", { as: "permissive", for: "select", to: ["public"] }),
]);

export const apiProviders = pgTable("api_providers", {
	id: integer().default(sql`nextval('api_providers_id_seq1'::regclass)`).primaryKey().notNull(),
	providerCode: varchar("provider_code", { length: 50 }).notNull(),
	providerName: varchar("provider_name", { length: 100 }).notNull(),
	description: text(),
	iconUrl: text("icon_url"),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	unique("api_providers_provider_code_key").on(table.providerCode),
]);

export const apiServicesOld = pgTable("api_services_old", {
	id: serial().primaryKey().notNull(),
	serviceType: varchar("service_type", { length: 50 }).notNull(),
	serviceName: varchar("service_name", { length: 100 }).notNull(),
	apiEndpoint: text("api_endpoint").notNull(),
	requestHeaders: jsonb("request_headers").default({}),
	requestBodyTemplate: jsonb("request_body_template").default({}),
	description: text(),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }),
}, (table) => [
	unique("api_services_service_type_key").on(table.serviceType),
]);

export const referenceImages = pgTable("reference_images", {
	id: integer().default(sql`nextval('reference_images_id_seq1'::regclass)`).primaryKey().notNull(),
	userId: text("user_id").notNull(),
	md5Hash: varchar("md5_hash", { length: 32 }).notNull(),
	cosKey: text("cos_key").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_reference_images_user_md5").using("btree", table.userId.asc().nullsLast().op("text_ops"), table.md5Hash.asc().nullsLast().op("text_ops")),
]);

export const modelCreditsConfig = pgTable("model_credits_config", {
	id: integer().default(sql`nextval('model_credits_config_id_seq1'::regclass)`).primaryKey().notNull(),
	modelKey: varchar("model_key", { length: 50 }).notNull(),
	modelName: varchar("model_name", { length: 100 }).notNull(),
	credits: integer().notNull(),
	description: text(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_model_credits_config_model_key").using("btree", table.modelKey.asc().nullsLast().op("text_ops")),
]);

export const apiParametersOld = pgTable("api_parameters_old", {
	id: serial().primaryKey().notNull(),
	serviceType: varchar("service_type", { length: 50 }).notNull(),
	paramKey: varchar("param_key", { length: 50 }).notNull(),
	paramLabel: varchar("param_label", { length: 100 }).notNull(),
	paramType: varchar("param_type", { length: 20 }).default('select'),
	options: jsonb().default([]),
	defaultValue: text("default_value"),
	isRequired: boolean("is_required").default(false),
	isActive: boolean("is_active").default(true),
	sortOrder: integer("sort_order").default(0),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	unique("api_parameters_service_type_param_key_key").on(table.serviceType, table.paramKey),
]);

export const apiParameters = pgTable("api_parameters", {
	id: integer().default(sql`nextval('api_parameters_id_seq1'::regclass)`).primaryKey().notNull(),
	serviceId: integer("service_id"),
	paramKey: varchar("param_key", { length: 50 }).notNull(),
	paramLabel: varchar("param_label", { length: 100 }).notNull(),
	paramType: varchar("param_type", { length: 20 }).default('select'),
	options: jsonb().default([]),
	defaultValue: text("default_value"),
	isRequired: boolean("is_required").default(false),
	sortOrder: integer("sort_order").default(0),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_api_parameters_service_id").using("btree", table.serviceId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.serviceId],
			foreignColumns: [apiServices.id],
			name: "api_parameters_new_service_id_fkey"
		}).onDelete("cascade"),
	unique("api_parameters_new_service_id_param_key_key").on(table.serviceId, table.paramKey),
]);

export const apiServices = pgTable("api_services", {
	id: integer().default(sql`nextval('api_services_id_seq1'::regclass)`).primaryKey().notNull(),
	providerId: integer("provider_id"),
	serviceType: varchar("service_type", { length: 50 }).notNull(),
	serviceName: varchar("service_name", { length: 100 }).notNull(),
	apiEndpoint: text("api_endpoint").notNull(),
	requestHeaders: jsonb("request_headers").default({}),
	requestBodyTemplate: jsonb("request_body_template").default({}),
	responseParser: jsonb("response_parser").default({}),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_api_services_provider_id").using("btree", table.providerId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.providerId],
			foreignColumns: [apiProviders.id],
			name: "api_services_new_provider_id_fkey"
		}).onDelete("cascade"),
	unique("api_services_new_provider_id_service_type_key").on(table.providerId, table.serviceType),
]);

export const apiConfigs = pgTable("api_configs", {
	id: integer().default(sql`nextval('api_configs_id_seq1'::regclass)`).primaryKey().notNull(),
	name: varchar({ length: 200 }).notNull(),
	serviceType: varchar("service_type", { length: 50 }).notNull(),
	description: text(),
	apiEndpoint: text("api_endpoint").notNull(),
	requestMethod: varchar("request_method", { length: 10 }).default('POST'),
	requestHeaders: jsonb("request_headers").default({}),
	requestBodyTemplate: jsonb("request_body_template").default({}),
	responseParser: jsonb("response_parser").default({}),
	apiKey: text("api_key"),
	isActive: boolean("is_active").default(true),
	sortOrder: integer("sort_order").default(0),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_api_configs_service_type").using("btree", table.serviceType.asc().nullsLast().op("text_ops")),
]);

export const apiModelsBackup = pgTable("api_models_backup", {
	id: serial().primaryKey().notNull(),
	serviceId: integer("service_id"),
	modelId: varchar("model_id", { length: 100 }).notNull(),
	modelName: varchar("model_name", { length: 100 }).notNull(),
	description: text(),
	creditsBase: integer("credits_base").default(10),
	extraConfig: jsonb("extra_config").default({}),
	sortOrder: integer("sort_order").default(0),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_api_models_service_id").using("btree", table.serviceId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.serviceId],
			foreignColumns: [apiServices.id],
			name: "api_models_new_service_id_fkey"
		}).onDelete("cascade"),
	unique("api_models_new_service_id_model_id_key").on(table.serviceId, table.modelId),
]);

export const apiModels = pgTable("api_models", {
	id: integer().default(sql`nextval('api_models_id_seq1'::regclass)`).primaryKey().notNull(),
	configId: integer("config_id"),
	modelId: varchar("model_id", { length: 100 }).notNull(),
	modelName: varchar("model_name", { length: 200 }).notNull(),
	description: text(),
	parameters: jsonb().default({}),
	creditsBase: integer("credits_base").default(10),
	isActive: boolean("is_active").default(true),
	sortOrder: integer("sort_order").default(0),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	apiEndpoint: text("api_endpoint"),
}, (table) => [
	index("idx_api_models_v2_config_id").using("btree", table.configId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.configId],
			foreignColumns: [apiConfigs.id],
			name: "api_models_v2_config_id_fkey"
		}).onDelete("cascade"),
	unique("api_models_v2_config_id_model_id_key").on(table.configId, table.modelId),
]);

export const apiCredentials = pgTable("api_credentials", {
	id: integer().default(sql`nextval('api_credentials_id_seq1'::regclass)`).primaryKey().notNull(),
	providerId: integer("provider_id"),
	credentialName: varchar("credential_name", { length: 100 }),
	apiKey: text("api_key"),
	apiSecret: text("api_secret"),
	description: text(),
	rateLimit: integer("rate_limit").default(60),
	isActive: boolean("is_active").default(true),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_api_credentials_provider_id").using("btree", table.providerId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.providerId],
			foreignColumns: [apiProviders.id],
			name: "api_credentials_new_provider_id_fkey"
		}).onDelete("cascade"),
]);

export const canvasConfig = pgTable("canvas_config", {
	id: serial().primaryKey().notNull(),
	configKey: varchar("config_key", { length: 100 }).notNull(),
	configType: varchar("config_type", { length: 50 }).notNull(),
	title: varchar({ length: 255 }),
	content: text(),
	isEnabled: boolean("is_enabled").default(true),
	sortOrder: integer("sort_order").default(0),
	extraData: jsonb("extra_data"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }),
}, (table) => [
	index("idx_canvas_config_key").using("btree", table.configKey.asc().nullsLast().op("text_ops")),
	index("idx_canvas_config_type").using("btree", table.configType.asc().nullsLast().op("text_ops")),
	unique("canvas_config_config_key_key").on(table.configKey),
]);

export const creditRefundLogs = pgTable("credit_refund_logs", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).default(sql`nextval('credit_refund_logs_id_seq1'::regclass)`).primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	taskId: text("task_id").notNull(),
	amount: integer().notNull(),
	reason: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_credit_refund_logs_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("idx_credit_refund_logs_task_id").using("btree", table.taskId.asc().nullsLast().op("text_ops")),
	index("idx_credit_refund_logs_user_id").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
]);

export const generationRecords = pgTable("generation_records", {
	id: integer().default(sql`nextval('generation_records_id_seq1'::regclass)`).primaryKey().notNull(),
	userId: text("user_id").notNull(),
	images: text().array().notNull(),
	model: text(),
	prompt: text(),
	resolution: text(),
	aspectRatio: text("aspect_ratio"),
	referenceImages: text("reference_images").array().default([""]),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	imageKeys: text("image_keys").array().default([""]),
	referenceImageMd5S: text("reference_image_md5s").array().default([""]),
	referenceImageKeys: text("reference_image_keys").array().default([""]),
	taskId: text("task_id"),
}, (table) => [
	index("idx_generation_records_created_at").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_generation_records_task_id").using("btree", table.taskId.asc().nullsLast().op("text_ops")),
	index("idx_generation_records_user_id").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	unique("unique_generation_task_id").on(table.taskId),
]);

export const redeemKeys = pgTable("redeem_keys", {
	id: integer().default(sql`nextval('redeem_keys_id_seq1'::regclass)`).primaryKey().notNull(),
	keyCode: varchar("key_code", { length: 32 }).notNull(),
	credits: integer().notNull(),
	status: varchar({ length: 20 }).default('unused').notNull(),
	usedBy: text("used_by"),
	usedAt: timestamp("used_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdBy: text("created_by"),
	channel: varchar({ length: 20 }).default('normal'),
	isLimited: boolean("is_limited").default(false),
}, (table) => [
	index("idx_redeem_keys_channel").using("btree", table.channel.asc().nullsLast().op("text_ops")),
	index("idx_redeem_keys_key_code").using("btree", table.keyCode.asc().nullsLast().op("text_ops")),
	index("idx_redeem_keys_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_redeem_keys_used_by").using("btree", table.usedBy.asc().nullsLast().op("text_ops")),
	unique("redeem_keys_key_code_key").on(table.keyCode),
]);

export const limitedChannelRedemptions = pgTable("limited_channel_redemptions", {
	id: serial().primaryKey().notNull(),
	userId: varchar("user_id", { length: 100 }).notNull(),
	phone: varchar({ length: 20 }),
	channel: varchar({ length: 20 }).notNull(),
	redeemedAt: timestamp("redeemed_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_limited_redemptions_channel").using("btree", table.channel.asc().nullsLast().op("text_ops")),
	index("idx_limited_redemptions_user").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	unique("limited_channel_redemptions_user_id_channel_key").on(table.userId, table.channel),
]);
