import { relations } from "drizzle-orm/relations";
import { apiServices, apiParameters, apiProviders, apiModelsBackup, apiConfigs, apiModels, apiCredentials } from "./schema";

export const apiParametersRelations = relations(apiParameters, ({one}) => ({
	apiService: one(apiServices, {
		fields: [apiParameters.serviceId],
		references: [apiServices.id]
	}),
}));

export const apiServicesRelations = relations(apiServices, ({one, many}) => ({
	apiParameters: many(apiParameters),
	apiProvider: one(apiProviders, {
		fields: [apiServices.providerId],
		references: [apiProviders.id]
	}),
	apiModelsBackups: many(apiModelsBackup),
}));

export const apiProvidersRelations = relations(apiProviders, ({many}) => ({
	apiServices: many(apiServices),
	apiCredentials: many(apiCredentials),
}));

export const apiModelsBackupRelations = relations(apiModelsBackup, ({one}) => ({
	apiService: one(apiServices, {
		fields: [apiModelsBackup.serviceId],
		references: [apiServices.id]
	}),
}));

export const apiModelsRelations = relations(apiModels, ({one}) => ({
	apiConfig: one(apiConfigs, {
		fields: [apiModels.configId],
		references: [apiConfigs.id]
	}),
}));

export const apiConfigsRelations = relations(apiConfigs, ({many}) => ({
	apiModels: many(apiModels),
}));

export const apiCredentialsRelations = relations(apiCredentials, ({one}) => ({
	apiProvider: one(apiProviders, {
		fields: [apiCredentials.providerId],
		references: [apiProviders.id]
	}),
}));