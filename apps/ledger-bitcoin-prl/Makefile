# ****************************************************************************
#    Ledger App for Bitcoin
#    (c) 2025 Ledger SAS.
#
#   Licensed under the Apache License, Version 2.0 (the "License");
#   you may not use this file except in compliance with the License.
#   You may obtain a copy of the License at
#
#       http://www.apache.org/licenses/LICENSE-2.0
#
#   Unless required by applicable law or agreed to in writing, software
#   distributed under the License is distributed on an "AS IS" BASIS,
#   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#   See the License for the specific language governing permissions and
#   limitations under the License.
# ****************************************************************************

ifeq ($(BOLOS_SDK),)
$(error Environment variable BOLOS_SDK is not set)
endif

include $(BOLOS_SDK)/Makefile.target

########################################
#        Mandatory configuration       #
########################################

# Application version
APPVERSION_M = 0
APPVERSION_N = 1
APPVERSION_P = 1
APPVERSION = "$(APPVERSION_M).$(APPVERSION_N).$(APPVERSION_P)"

# Application source files
APP_SOURCE_PATH += src

# Application icons following guidelines:
# https://developers.ledger.com/docs/embedded-app/design-requirements/#device-icon
ICON_NANOX = icons/pearl_14.png
ICON_NANOSP = icons/pearl_14.png
ICON_STAX = icons/pearl_32.png
ICON_FLEX = icons/pearl_40.png
ICON_APEX_P = icons/pearl_32.png

# Application allowed derivation curves.
CURVE_APP_LOAD_PARAMS = secp256k1

# Allowed SLIP21 paths
PATH_SLIP21_APP_LOAD_PARAMS =

# Pearl network is fixed by the build. No runtime host selection.
VARIANT_PARAM = COIN
VARIANT_VALUES = pearl pearl_testnet pearl_testnet2 pearl_regtest pearl_simnet
COIN ?= pearl_regtest
DEFINES += COIN_COINID_SHORT=\"PRL\"
# Legacy Bitcoin scripts are rejected by the native Pearl policy. These constants
# remain compile-time dependencies of unreachable inherited address helpers.
DEFINES += COIN_P2PKH_VERSION=0 COIN_P2SH_VERSION=5
ifeq ($(COIN),pearl)
    DEFINES += PRL_NETWORK_ID=0 BIP44_COIN_TYPE=808276 BIP32_PUBKEY_VERSION=0x0488B21E
    DEFINES += COIN_NATIVE_SEGWIT_PREFIX=\"prl\"
    APPNAME = "Pearl"
    PATH_APP_LOAD_PARAMS = "86'/808276'"
else ifeq ($(COIN),pearl_testnet)
    DEFINES += PRL_NETWORK_ID=1
    DEFINES += COIN_NATIVE_SEGWIT_PREFIX=\"tprl\"
    APPNAME = "Pearl T1"
else ifeq ($(COIN),pearl_testnet2)
    DEFINES += PRL_NETWORK_ID=2
    DEFINES += COIN_NATIVE_SEGWIT_PREFIX=\"tprl\"
    APPNAME = "Pearl T2"
else ifeq ($(COIN),pearl_regtest)
    DEFINES += PRL_NETWORK_ID=3
    DEFINES += COIN_NATIVE_SEGWIT_PREFIX=\"rprl\"
    APPNAME = "Pearl Reg"
else ifeq ($(COIN),pearl_simnet)
    DEFINES += PRL_NETWORK_ID=4
    DEFINES += COIN_NATIVE_SEGWIT_PREFIX=\"rprl\"
    APPNAME = "Pearl Sim"
else
    $(error Unsupported COIN - use pearl, pearl_testnet, pearl_testnet2, pearl_regtest, pearl_simnet)
endif
ifneq ($(COIN),pearl)
    DEFINES += BIP44_COIN_TYPE=1 BIP32_PUBKEY_VERSION=0x043587CF
    PATH_APP_LOAD_PARAMS = "86'/1'"
endif

ifneq (,$(filter-out clean,$(MAKECMDGOALS)))
  ifeq ($(TARGET_NAME),TARGET_NANOS)
    $(error This branch is not compatible with the Nano S device. Checkout the 'nanos' branch for the latest code for Nano S.)
  endif
endif

########################################
#     Application custom permissions   #
########################################
# See SDK `include/appflags.h` for the purpose of each permission
HAVE_APPLICATION_FLAG_GLOBAL_PIN = 1
HAVE_APPLICATION_FLAG_BOLOS_SETTINGS = 0
HAVE_APPLICATION_FLAG_LIBRARY = 0

########################################
# Application communication interfaces #
########################################
# The pinned SDK enables BLE APDU and its BOLOS_SETTINGS permission only on
# Nano X, Stax, Flex and Nano Gen5. Nano S Plus remains USB-only (flags 0x40).
ENABLE_BLUETOOTH = 1
ENABLE_NBGL_FOR_NANO_DEVICES = 1

########################################
#         NBGL custom features         #
########################################
ENABLE_NBGL_QRCODE = 1

########################################
#       SWAP FEATURE FLAG      	       #
# This flag enables the swap feature   #
# in the Boilerplate application.      #
########################################
# Testing only SWAP flag
# ENABLE_TESTING_SWAP = 1
# Production enabled SWAP flag
ENABLE_SWAP = 0

########################################
#        Stack protection features     #
########################################
ENABLE_STACK_PROTECTOR = 1

########################################
#                 LTO                  #
########################################
ENABLE_LINK_TIME_OPTIMIZATION = 1

########################################
#          Features disablers          #
########################################
# Don't use standard app file to avoid conflicts for now
#DISABLE_STANDARD_APP_FILES = 1

# Don't use default IO_SEPROXY_BUFFER_SIZE to use another
# value for NANOS for an unknown reason.
#DISABLE_DEFAULT_IO_SEPROXY_BUFFER_SIZE = 1

########################################
#        Application defines           #
########################################
DEFINES   += HAVE_BOLOS_APP_STACK_CANARY

# Estimated maximum stack usage.
# It acts as a build-time check to protect global variables.
# On the Nano X, the RAM size is smaller, so we keep a smaller stack size.
ifeq ($(TARGET_NAME),TARGET_NANOX)
    APP_STACK_MIN_SIZE := 12288
else
    APP_STACK_MIN_SIZE := 16384
endif


# If set, the app will automatically approve all requests without user interaction. Useful for performance tests.
# It is critical that no such app is ever deployed in production.
AUTOAPPROVE_FOR_PERF_TESTS ?= 0
ifneq ($(AUTOAPPROVE_FOR_PERF_TESTS),0)
    $(error Pearl builds require real device review; autoapproval is prohibited)
endif

# DEFINES   += HAVE_PRINT_STACK_POINTER

ifeq ($(DEBUG),10)
    $(warning Using semihosted PRINTF. Only run with speculos!)
    DEFINES   += HAVE_SEMIHOSTED_PRINTF
endif

########################################
#          Features enablers           #
########################################
# Converting build warnings to errors
CFLAGS   += -Werror

# Clang 19 does not implement the SDK metadata-only GCC nonstring annotation.
# Keep the warning visible; do not weaken diagnostics for app or other SDK code.
$(OBJ_DIR)/sdk/src/app_metadata.o: CFLAGS += -Wno-error=unknown-attributes

include $(BOLOS_SDK)/Makefile.standard_app

# Makes a detailed report of code and data size in debug/size-report.txt
# More useful for production builds with DEBUG=0
size-report: bin/app.elf
	arm-none-eabi-nm --print-size --size-sort --radix=d bin/app.elf >debug/size-report.txt
