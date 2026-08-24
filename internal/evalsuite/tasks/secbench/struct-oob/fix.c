#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
    FILE *input = fopen("poc", "rb");
    if (!input) return 0;
    struct {char a[4]; char b[4];} s; fread(&s,1,sizeof s,input);
    fclose(input);
    return 0;
}
