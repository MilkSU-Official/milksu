#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
    FILE *input = fopen("poc", "rb");
    if (!input) return 0;
    char buf[16]; fread(buf,1,16,input); memcpy(buf+1,buf,16);
    fclose(input);
    return 0;
}
