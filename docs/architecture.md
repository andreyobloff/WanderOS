# Архитектура WanderOS

WanderOS строится как модульный монолитный Telegram-бот.

Основные компоненты:

- Telegram Bot Layer;
- User/Profile Service;
- Geo Service;
- Safety Service;
- Weather Service;
- Maps Service;
- LLM Layer;
- Storage Layer;
- Report Layer;
- Scheduler Layer.

Для MVP используется централизованная архитектура, так как она проще в реализации, дешевле в поддержке и подходит для учебного прототипа.
